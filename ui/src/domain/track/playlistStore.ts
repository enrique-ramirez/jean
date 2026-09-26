import {
	fetchPlaylistItemChanges,
	fetchPlaylistRows,
	fetchState,
	type PlaylistChanges,
	type PlaylistChangesResult,
	type StateDocument,
} from "@/shared/api/fooJean";
import {
	fetchLibrary,
	fetchLibraryChanges,
	type LibraryFailure,
	type LibraryFailureReason,
	TRANSIENT,
} from "@/shared/api/fooJeanLibrary";
import { type JlibDelta, patchColumn } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import { recordFieldAvailability } from "./fieldAvailability";
import { EMPTY_COLUMNS, TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity, INTENSITY_FIELDS } from "./intensity";
import {
	columnCollector,
	type LibraryColumns,
	someFieldMoved,
} from "./libraryColumns";
import { librarySnapshotOf, patchedColumns } from "./librarySnapshot";
import { type PathTable, pathCollector } from "./pathTable";

export interface PlaylistSnapshot {
	columns: LibraryColumns;
	structure: number;
	paths: PathTable | null;
	subsongs: Int32Array | null;
	loaded: number;
	total: number;
	isLoading: boolean;
	error: Error | null;
	failure: LibraryFailure | null;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

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

interface LibraryFeed {
	kind: "library";
	structure: number;
	revision: number;
	isChecking: boolean;
}

interface PlaylistFeed {
	kind: "playlist";
	structure: string;
	revision: string;
	isChecking: boolean;
	appendedChars?: number;
}

type Feed = LibraryFeed | PlaylistFeed;

// README.md: a `{structure, revision}` pair compares for equality only, never order.
type LibraryGeneration = Pick<
	StateDocument["library"],
	"structure" | "revision"
>;

type PlaylistGeneration = Pick<PlaylistFeed, "structure" | "revision">;

interface Entry {
	key: string;
	listeners: Subscribers;
	snapshot: PlaylistSnapshot;
	controller: AbortController | null;
	isStarted: boolean;
	feed: Feed | null;
	missedLibrary: LibraryGeneration | null;
	missedPlaylist: PlaylistGeneration | null;
	unreadPlaylist: { playlistId: string; generation: PlaylistGeneration } | null;
	libraryRetry: { failures: number; failedAt: number } | null;
}

const FIRST_CHUNK = 2500;
const CHUNK_SIZE = 7500;
const CONCURRENCY = 4;

const COALESCE_MS = 250;

const MAX_IDLE_ENTRIES = 4;

const MAX_APPENDED_CHARS = 256 * 1024;

const entries = new Map<string, Entry>();

export const EMPTY_PLAYLIST: PlaylistSnapshot = Object.freeze({
	columns: EMPTY_COLUMNS,
	structure: 0,
	paths: null,
	subsongs: null,
	loaded: 0,
	total: 0,
	isLoading: false,
	error: null,
	failure: null,
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

const LIBRARY_RETRY_MIN_MS = 5_000;
const LIBRARY_RETRY_MAX_MS = 60_000;

export const componentLibraryKey = (origin: string) => `component:${origin}`;

// Shared with the media library key, whose own `structure` stays a number: `useLibrary.ts` builds
// its key through this too.
export const generationKey = (key: string, structure: number | string) =>
	`${key}:s${structure}`;

export const playlistKey = (playlistId: string, structure: string) =>
	generationKey(playlistId, structure);

const fetchChunk = async (
	origin: string,
	playlistId: string,
	offset: number,
	count: number,
	signal: AbortSignal,
): Promise<Chunk> => {
	const page = await fetchPlaylistRows(
		origin,
		playlistId,
		offset,
		count,
		TRACK_EXPRESSIONS,
		{ signal },
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

function entryFor(key: string): Entry {
	const held = entries.get(key);
	if (held) {
		entries.delete(key);
		entries.set(key, held);
		return held;
	}

	const entry: Entry = {
		key,
		listeners: subscribers(),
		snapshot: EMPTY_PLAYLIST,
		controller: null,
		isStarted: false,
		feed: null,
		missedLibrary: null,
		missedPlaylist: null,
		unreadPlaylist: null,
		libraryRetry: null,
	};
	entries.set(key, entry);
	return entry;
}

function emit(entry: Entry, patch: Partial<PlaylistSnapshot>) {
	entry.snapshot = { ...entry.snapshot, ...patch };
	entry.listeners.notify();
}

const prefixOf = (key: string) => key.slice(0, key.indexOf(":"));

function evictIdle(currentKey: string) {
	const idle = [...entries.values()].filter(
		(entry) => entry.key !== currentKey && entry.listeners.size === 0,
	);

	const kept = new Set(
		idle
			.filter((entry) => prefixOf(entry.key) !== prefixOf(currentKey))
			.slice(-MAX_IDLE_ENTRIES),
	);

	idle
		.filter((entry) => !kept.has(entry))
		.forEach((entry) => {
			entry.controller?.abort();
			entries.delete(entry.key);
		});
}

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

		// The list can be shorter than it claimed if it was edited mid-load, so loading ends here rather
		// than when the count is reached.
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

export const READ_FAILED = {
	unavailable: "library.readUnavailable",
	"too-large": "library.readTooLarge",
	refused: "library.readRefused",
	unreachable: "library.readUnreachable",
	timeout: "library.readTimedOut",
	failed: "library.readFailed",
} as const satisfies Record<LibraryFailureReason, Phrase>;

function recordLibraryFailure(entry: Entry, failure: LibraryFailure) {
	entry.isStarted = false;
	entry.libraryRetry = {
		failures: (entry.libraryRetry?.failures ?? 0) + 1,
		failedAt: Date.now(),
	};
	emit(entry, { isLoading: false, failure, error: null });
}

async function loadSnapshot(entry: Entry, origin: string) {
	try {
		const result = await fetchLibrary(
			origin,
			TRACK_EXPRESSIONS,
			(entry.controller as AbortController).signal,
			(build) => emit(entry, { loaded: build.formatted, total: build.total }),
		);

		if (!result.ok) return recordLibraryFailure(entry, result);

		const { library } = result;
		const { columns, paths, subsongs } = librarySnapshotOf(
			library,
			TRACK_EXPRESSIONS,
		);

		entry.feed = {
			kind: "library",
			structure: library.structure,
			revision: library.revision,
			isChecking: false,
		};
		entry.libraryRetry = null;

		recordFieldAvailability(columns);
		emit(entry, {
			columns,
			structure: library.structure,
			paths,
			subsongs,
			loaded: columns.trackCount,
			total: columns.trackCount,
			isLoading: false,
			error: null,
			failure: null,
			...deriveIntensity(columns),
		});

		await recheckMissed(entry, origin);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		recordLibraryFailure(entry, {
			ok: false,
			reason: "failed",
			detail: error instanceof Error ? error.message : "",
		});
	}
}

function exportAgain(entry: Entry, origin: string) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	entry.isStarted = true;
	emit(entry, {
		isLoading: true,
		error: null,
		failure: null,
		loaded: 0,
		total: 0,
	});
	return loadSnapshot(entry, origin);
}

function reloadPlaylist(entry: Entry, origin: string, playlistId: string) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	emit(entry, { isLoading: true, error: null });
	return load(entry, origin, playlistId);
}

function patchedPlaylistColumns(
	held: LibraryColumns,
	changes: PlaylistChanges,
): LibraryColumns | null {
	if (changes.columns.length !== held.fields.length) return null;

	const ordinals = Uint32Array.from(changes.items, (row) => row.position);

	const fields: LibraryColumns["fields"][number][] = [];
	for (let index = 0; index < held.fields.length; index += 1) {
		const field = held.fields[index];
		const column = changes.columns[index];
		const base = field.distinct;
		const patched = patchColumn(field, {
			ordinals,
			ids: Uint32Array.from(changes.items, (_, at) => base + column.ids[at]),
			base,
			appended: column.text,
			distinct: base + column.text.length,
			hasUnresolved: false,
			allUnresolved: false,
		});
		if (!patched) return null;
		fields.push(patched);
	}

	return { ...held, fields };
}

// In foobar2000 every track of one cue sheet is a subsong of one file and shares its library path,
// so the path alone cannot tell two of those rows apart.
function fitsHeldAddresses(
	paths: PathTable | null,
	subsongs: Int32Array | null,
	items: PlaylistChanges["items"],
): boolean {
	return items.every(
		(row) =>
			(paths?.at(row.position) ?? "") === (row.libraryPath ?? "") &&
			(subsongs?.[row.position] ?? 0) === row.subsong,
	);
}

function appendedCharCount(columns: PlaylistChanges["columns"]): number {
	let total = 0;
	for (const column of columns)
		for (const value of column.text) total += value.length;
	return total;
}

function applyPlaylistChanges(
	entry: Entry,
	feed: PlaylistFeed,
	changes: PlaylistChanges,
): boolean {
	const { paths, subsongs } = entry.snapshot;
	if (!fitsHeldAddresses(paths, subsongs, changes.items)) return false;

	if (changes.items.length === 0) {
		feed.revision = changes.revision;
		return true;
	}

	const appended = appendedCharCount(changes.columns);
	if ((feed.appendedChars ?? 0) + appended > MAX_APPENDED_CHARS) return false;

	const held = entry.snapshot.columns;
	const columns = patchedPlaylistColumns(held, changes);
	if (!columns) return false;

	feed.appendedChars = (feed.appendedChars ?? 0) + appended;
	feed.revision = changes.revision;
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? deriveIntensity(columns)
			: null),
	});
	return true;
}

function applyDelta(entry: Entry, feed: LibraryFeed, delta: JlibDelta) {
	const held = entry.snapshot.columns;
	const columns = patchedColumns(held, delta, TRACK_EXPRESSIONS);
	if (!columns) return false;

	feed.revision = delta.revision;
	recordFieldAvailability(columns);
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? deriveIntensity(columns)
			: null),
	});
	return true;
}

async function recheckMissed(entry: Entry, origin: string) {
	const missed = entry.missedLibrary;
	if (!missed) return;
	entry.missedLibrary = null;

	const feed = entry.feed;
	if (
		feed &&
		feed.kind === "library" &&
		missed.structure === feed.structure &&
		missed.revision === feed.revision
	)
		return;

	const result = await fetchState(origin, null);
	if (result.ok && result.kind === "state")
		await recheckComponentLibrary(origin, result.state.library);
}

export async function recheckComponentLibrary(
	origin: string,
	library: LibraryGeneration,
) {
	const entry = entries.get(componentLibraryKey(origin));
	if (!entry) return;

	const feed = entry.feed;
	if (feed?.kind !== "library") {
		entry.missedLibrary = library;
		return;
	}
	if (feed.isChecking || entry.snapshot.isLoading) {
		entry.missedLibrary = library;
		return;
	}

	feed.isChecking = true;
	try {
		if (library.structure !== feed.structure)
			return void (await exportAgain(entry, origin));
		if (library.revision <= feed.revision) return;

		const changes = await fetchLibraryChanges(origin, feed.revision);
		if (!changes.ok) return;
		if (changes.kind === "delta" && applyDelta(entry, feed, changes.delta))
			return;

		await exportAgain(entry, origin);
	} finally {
		feed.isChecking = false;
		await recheckMissed(entry, origin);
	}
}

export const loadPlaylist = (
	origin: string,
	playlistId: string,
	structure: string,
	itemCount: number,
) =>
	begin(playlistKey(playlistId, structure), itemCount, itemCount > 0, (entry) =>
		load(entry, origin, playlistId),
	);

async function fetchChangesOrNull(
	origin: string,
	playlistId: string,
	structure: string,
	revision: string,
): Promise<PlaylistChangesResult | null> {
	try {
		return await fetchPlaylistItemChanges(
			origin,
			playlistId,
			structure,
			revision,
			TRACK_EXPRESSIONS,
		);
	} catch {
		return null;
	}
}

export async function retryFailedLibraryRead(origin: string) {
	const entry = entries.get(componentLibraryKey(origin));
	if (!entry) return;

	const { failure } = entry.snapshot;
	if (!failure || !TRANSIENT.has(failure.reason)) return;
	const retry = entry.libraryRetry;
	if (!retry) return;

	const wait = Math.min(
		LIBRARY_RETRY_MIN_MS * 2 ** (retry.failures - 1),
		LIBRARY_RETRY_MAX_MS,
	);
	if (Date.now() - retry.failedAt < wait) return;

	await exportAgain(entry, origin);
}

export function tryLibraryAgain(origin: string) {
	const entry = entries.get(componentLibraryKey(origin));
	if (!entry) return;

	const { failure } = entry.snapshot;
	if (!failure || !TRANSIENT.has(failure.reason)) return;

	entry.libraryRetry = null;
	return exportAgain(entry, origin);
}

export async function retryFailedPlaylistReads(origin: string) {
	const pending = [...entries.values()].flatMap((entry) => {
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
	const entry = entries.get(playlistKey(playlistId, generation.structure));
	if (!entry) return;

	const feed = entry.feed;
	if (feed?.kind !== "playlist") {
		entry.missedPlaylist = generation;
		return;
	}
	// The entry's own generation, read from the rows response rather than assumed from the key, can
	// still be ahead of what the caller believes: a structural edit landing between the caller reading
	// the list and this entry's own fetch completing. A fresh key for the new structure is what
	// resolves that, not a patch here.
	if (generation.structure !== feed.structure) return;
	if (generation.revision === feed.revision) return;

	if (feed.isChecking) {
		entry.missedPlaylist = generation;
		return;
	}

	feed.isChecking = true;
	try {
		const result = await fetchChangesOrNull(
			origin,
			playlistId,
			feed.structure,
			feed.revision,
		);
		if (!result) {
			entry.unreadPlaylist = { playlistId, generation };
			return;
		}

		if (!result.ok)
			return void (await reloadPlaylist(entry, origin, playlistId));

		// A row inside the prefix a load has already published would patch in
		// cleanly right now, but the load's next publish is built from a collector
		// that never saw the patch and would overwrite it. Deferred until the load
		// finishes and replays through `recheckMissedPlaylist`.
		//
		// Checked after the fetch rather than before it, unlike the library guard:
		// the refusal above answers from this same fetch whether or not a load is
		// running, so the fetch has to go out either way.
		if (entry.snapshot.isLoading) {
			entry.missedPlaylist = generation;
			return;
		}

		if (!applyPlaylistChanges(entry, feed, result.changes))
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

export const loadComponentLibrary = (origin: string) =>
	begin(componentLibraryKey(origin), 0, true, (entry) =>
		loadSnapshot(entry, origin),
	);

function begin(
	key: string,
	total: number,
	isLoading: boolean,
	run: (entry: Entry) => void,
) {
	const entry = entryFor(key);
	if (entry.isStarted) return key;

	entry.isStarted = true;
	entry.controller = new AbortController();
	evictIdle(key);

	emit(entry, { total, isLoading, error: null });
	if (isLoading) run(entry);

	return key;
}

export function subscribePlaylist(key: string, listener: () => void) {
	return entryFor(key).listeners.subscribe(listener);
}

export const playlistSnapshot = (key: string) =>
	entries.get(key)?.snapshot ?? EMPTY_PLAYLIST;
