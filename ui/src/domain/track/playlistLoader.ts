import { orThrow } from "@/shared/api/client";
import {
	fetchPlaylistItemChanges,
	fetchPlaylistRows,
	type PlaylistChanges,
} from "@/shared/api/playlists";
import type { TrackColumns } from "@/shared/api/types";
import { TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity, INTENSITY_FIELDS } from "./intensity";
import { columnCollector, someFieldMoved } from "./libraryColumns";
import { pathCollector } from "./pathTable";
import {
	begin,
	type Entry,
	emit,
	entryFor,
	everyEntry,
	heldEntry,
	type PlaylistFeed,
	type PlaylistGeneration,
	playlistKey,
} from "./playlistEntries";
import { patchPlaylist, reorderedSnapshot } from "./playlistPatch";

interface Chunk {
	rows: TrackColumns[];
	// The empty string where the row's track is not in the library, matching how `PathTable` already
	// answers an out-of-range ref: nothing for `artworkUrl` to draw from.
	paths: string[];
	subsongs: number[];
	totalCount: number;
	structure: string;
	revision: string;
}

const FIRST_CHUNK = 2500;
const CHUNK_SIZE = 7500;
const CONCURRENCY = 4;

const COALESCE_MS = 250;

const fetchChunk = async (
	origin: string,
	playlistId: string,
	offset: number,
	count: number,
	signal: AbortSignal,
): Promise<Chunk> => {
	const page = orThrow(
		await fetchPlaylistRows(
			origin,
			playlistId,
			offset,
			count,
			TRACK_EXPRESSIONS,
			{ signal },
		),
	);
	return {
		rows: page.items.map((item) => item.columns),
		paths: page.items.map((item) => item.libraryPath ?? ""),
		subsongs: page.items.map((item) => item.subsong),
		totalCount: page.totalCount,
		structure: page.structure,
		revision: page.revision,
	};
};

async function load(entry: Entry, origin: string, playlistId: string) {
	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	const paths = pathCollector();
	const subsongs: number[] = [];

	const addChunk = (chunk: Chunk) => {
		collector.add(chunk.rows);
		for (const path of chunk.paths) paths.add(path);
		for (const subsong of chunk.subsongs) subsongs.push(subsong);
	};

	const publish = (totalCount: number, isLoading: boolean) => {
		const columns = collector.table();
		emit(entry, {
			columns,
			paths: paths.table(),
			subsongs: Int32Array.from(subsongs),
			loaded: columns.trackCount,
			total: totalCount,
			isLoading,
			error: null,
			...deriveIntensity(columns),
		});
	};

	let scheduled: ReturnType<typeof setTimeout> | null = null;
	let deferred: { totalCount: number; isLoading: boolean } | null = null;

	const publishSoon = (totalCount: number, isLoading: boolean) => {
		deferred = { totalCount, isLoading };
		if (scheduled) return;
		scheduled = setTimeout(() => {
			scheduled = null;
			const held = deferred;
			deferred = null;
			if (held) publish(held.totalCount, held.isLoading);
		}, COALESCE_MS);
	};

	const dropDeferred = () => {
		if (scheduled) clearTimeout(scheduled);
		scheduled = null;
		deferred = null;
	};

	try {
		const signal = (entry.controller as AbortController).signal;
		const first = await fetchChunk(origin, playlistId, 0, FIRST_CHUNK, signal);
		addChunk(first);
		entry.feed = {
			kind: "playlist",
			structure: first.structure,
			revision: first.revision,
			isChecking: false,
			appendedChars: 0,
		};

		const total = first.totalCount;
		publish(total, collector.count() < total);
		if (collector.count() >= total)
			return void (await recheckMissedPlaylist(entry, origin, playlistId));

		const held = collector.count();
		const offsets = Array.from(
			{ length: Math.ceil((total - held) / CHUNK_SIZE) },
			(_, at) => held + at * CHUNK_SIZE,
		);

		const pending = new Map<number, Chunk>();
		const queue = [...offsets];
		let appended = 0;

		const drainInOrder = () => {
			while (appended < offsets.length && pending.has(offsets[appended])) {
				addChunk(pending.get(offsets[appended]) as Chunk);
				pending.delete(offsets[appended]);
				appended += 1;
			}
		};

		const worker = async () => {
			while (queue.length > 0) {
				const offset = queue.shift() as number;
				pending.set(
					offset,
					await fetchChunk(origin, playlistId, offset, CHUNK_SIZE, signal),
				);
				drainInOrder();
				publishSoon(total, collector.count() < total);
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
		);

		dropDeferred();
		publish(total, false);
		await recheckMissedPlaylist(entry, origin, playlistId);
	} catch (error) {
		dropDeferred();
		if (error instanceof Error && error.name === "AbortError") return;
		entry.isStarted = false;
		emit(entry, {
			isLoading: false,
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
}

function reloadPlaylist(entry: Entry, origin: string, playlistId: string) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	emit(entry, { isLoading: true, error: null });
	return load(entry, origin, playlistId);
}

function applyPlaylistChanges(
	entry: Entry,
	feed: PlaylistFeed,
	changes: PlaylistChanges,
): boolean {
	const patch = patchPlaylist(entry.snapshot, feed.appendedChars, changes);
	if (patch.kind === "reload") return false;

	feed.revision = changes.revision;
	if (patch.kind === "unchanged") return true;

	const held = entry.snapshot.columns;
	feed.appendedChars = patch.appendedChars;
	emit(entry, {
		columns: patch.columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, patch.columns)
			? deriveIntensity(patch.columns)
			: null),
	});
	return true;
}

interface Hold {
	count: number;
	deferred: Map<string, () => void>;
}

const holds = new Map<string, Hold>();

// The poll announces a move's structure before the write's answer lands, and a view asked for the
// playlist at it would read the rows again. Holding lets the answer carry the rows instead.
export function holdPlaylistLoads(playlistId: string): () => void {
	const hold = holds.get(playlistId) ?? { count: 0, deferred: new Map() };
	holds.set(playlistId, hold);
	hold.count += 1;

	let isReleased = false;
	return () => {
		if (isReleased) return;
		isReleased = true;
		hold.count -= 1;
		if (hold.count > 0) return;
		holds.delete(playlistId);
		for (const start of hold.deferred.values()) start();
	};
}

// `foo_jean` keeps a change window per structure and drops it when the structure moves, so the
// revision a carried feed brings from the old structure is past it. The first revision a poll
// reports at the new structure is taken as held instead of reloading the playlist.
const carriedFeeds = new WeakSet<PlaylistFeed>();

export function carryPlaylist(
	playlistId: string,
	from: string,
	to: string,
	order: ArrayLike<number>,
): boolean {
	const held = heldEntry(playlistKey(playlistId, from));
	if (held?.feed?.kind !== "playlist" || held.snapshot.isLoading) return false;
	if (order.length > held.snapshot.columns.trackCount) return false;

	const carried = entryFor(playlistKey(playlistId, to));
	if (carried.isStarted) return false;

	carried.isStarted = true;
	carried.controller = new AbortController();
	carried.feed = { ...held.feed, structure: to, isChecking: false };
	// A poll that reached the new structure before this carry has already had its say, and it
	// asked nothing: the first `410` after this carry is a genuine one, so it is not the mark's.
	if (carried.missedPlaylist?.structure === to) carried.missedPlaylist = null;
	else carriedFeeds.add(carried.feed);
	emit(
		carried,
		reorderedSnapshot(held.snapshot, order, held.snapshot.structure),
	);
	return true;
}

export function loadPlaylist(
	origin: string,
	playlistId: string,
	structure: string,
	itemCount: number,
) {
	const key = playlistKey(playlistId, structure);
	const start = () =>
		begin(key, itemCount, itemCount > 0, (entry) =>
			load(entry, origin, playlistId),
		);

	const hold = holds.get(playlistId);
	if (!hold) return start();

	hold.deferred.set(key, start);
	return key;
}

export async function retryFailedPlaylistReads(origin: string) {
	const pending = everyEntry().flatMap((entry) => {
		const unread = entry.unreadPlaylist;
		if (!unread) return [];
		entry.unreadPlaylist = null;
		return [unread];
	});

	for (const { playlistId, generation } of pending)
		await recheckPlaylist(origin, playlistId, generation);
}

export async function recheckPlaylist(
	origin: string,
	playlistId: string,
	generation: PlaylistGeneration,
) {
	const entry = heldEntry(playlistKey(playlistId, generation.structure));
	if (!entry) return;

	const feed = entry.feed;
	if (feed?.kind !== "playlist") {
		entry.missedPlaylist = generation;
		return;
	}
	if (generation.structure !== feed.structure) return;
	if (generation.revision === feed.revision) return;

	if (feed.isChecking) {
		entry.missedPlaylist = generation;
		return;
	}

	feed.isChecking = true;
	try {
		const result = await fetchPlaylistItemChanges(
			origin,
			playlistId,
			feed.structure,
			feed.revision,
			TRACK_EXPRESSIONS,
		);
		if (!result.ok && result.reason !== "moved" && result.reason !== "gone") {
			entry.unreadPlaylist = { playlistId, generation };
			return;
		}

		if (!result.ok && result.reason === "gone" && carriedFeeds.has(feed)) {
			feed.revision = generation.revision;
			carriedFeeds.delete(feed);
			return;
		}

		if (!result.ok)
			return void (await reloadPlaylist(entry, origin, playlistId));

		carriedFeeds.delete(feed);
		if (entry.snapshot.isLoading) {
			entry.missedPlaylist = generation;
			return;
		}

		if (!applyPlaylistChanges(entry, feed, result.value))
			return void (await reloadPlaylist(entry, origin, playlistId));
	} finally {
		if (entry.feed === feed) feed.isChecking = false;
		await recheckMissedPlaylist(entry, origin, playlistId);
	}
}

async function recheckMissedPlaylist(
	entry: Entry,
	origin: string,
	playlistId: string,
) {
	const missed = entry.missedPlaylist;
	if (!missed || entry.snapshot.isLoading) return;
	entry.missedPlaylist = null;
	await recheckPlaylist(origin, playlistId, missed);
}
