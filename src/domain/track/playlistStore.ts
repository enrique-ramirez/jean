import { fetchLibraryItems, fetchPlaylistItems } from "@/shared/api/beefweb";
import type { TrackColumns } from "@/shared/api/types";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import { TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity } from "./intensity";
import { type PathCollector, type PathTable, pathCollector } from "./pathTable";

// `paths` and `subsongs` are parallel to `rows` and present only on the media library. Null rather
// than empty on a playlist, so reaching for them on the wrong source fails loudly.
export interface PlaylistSnapshot {
	rows: TrackColumns[];
	paths: PathTable | null;
	subsongs: number[] | null;
	loaded: number;
	total: number;
	isLoading: boolean;
	error: Error | null;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

type LoadSource =
	| { kind: "playlist"; playlistId: string }
	| { kind: "library" };

interface Chunk {
	rows: TrackColumns[];
	totalCount: number;
	paths: string[] | null;
	subsongs: number[] | null;
}

interface Entry {
	key: string;
	listeners: Subscribers;
	snapshot: PlaylistSnapshot;
	controller: AbortController | null;
	isStarted: boolean;
}

// On a playlist almost all the cost is the round trip, so paint from one modest chunk and then
// fetch large concurrent ones. The media library endpoint has no cache and re-enumerates on every
// call, so concurrency buys nothing there.
const STRATEGY = {
	playlist: { firstChunk: 2500, chunkSize: 7500, concurrency: 4 },
	library: { firstChunk: 500, chunkSize: Infinity, concurrency: 1 },
};

const COALESCE_MS = 250;

const MAX_IDLE_ENTRIES = 4;

const entries = new Map<string, Entry>();

export const EMPTY_PLAYLIST: PlaylistSnapshot = Object.freeze({
	rows: [],
	paths: null,
	subsongs: null,
	loaded: 0,
	total: 0,
	isLoading: false,
	error: null,
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

export const playlistKey = (playlistId: string, itemCount: number) =>
	`${playlistId}:${itemCount}`;

export const libraryKey = (itemCount: number) => `library:${itemCount}`;

const fetchChunk = async (
	source: LoadSource,
	offset: number,
	count: number,
	signal: AbortSignal,
): Promise<Chunk> => {
	if (source.kind === "playlist") {
		const chunk = await fetchPlaylistItems(
			source.playlistId,
			offset,
			count,
			TRACK_EXPRESSIONS,
			{
				signal,
			},
		);
		return {
			rows: chunk.rows,
			totalCount: chunk.totalCount,
			paths: null,
			subsongs: null,
		};
	}

	const chunk = await fetchLibraryItems({
		columns: TRACK_EXPRESSIONS,
		offset,
		count,
		signal,
	});
	return {
		rows: chunk.items.map((item) => item.columns),
		totalCount: chunk.totalCount,
		paths: chunk.items.map((item) => item.path),
		subsongs: chunk.items.map((item) => item.subsong ?? 0),
	};
};

function entryFor(key: string): Entry {
	const held = entries.get(key);
	if (held) {
		// Re-inserted, since the eviction below reads insertion order as recency.
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
	};
	entries.set(key, entry);
	return entry;
}

function emit(entry: Entry, patch: Partial<PlaylistSnapshot>) {
	entry.snapshot = { ...entry.snapshot, ...patch };
	entry.listeners.notify();
}

const prefixOf = (key: string) => key.slice(0, key.indexOf(":"));

// A superseded entry -- same playlist, different item count -- always goes. The rest are merely
// old, and insertion order is recency.
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

async function load(entry: Entry, source: LoadSource) {
	const { firstChunk, chunkSize, concurrency } = STRATEGY[source.kind];
	const isLibrary = source.kind === "library";

	const rows: TrackColumns[] = [];
	const paths: PathCollector | null = isLibrary ? pathCollector() : null;
	const subsongs: number[] | null = isLibrary ? [] : null;

	const publish = (totalCount: number, isLoading: boolean) => {
		// A fresh array reference each time, so consumers re-render.
		const snapshot = [...rows];
		emit(entry, {
			rows: snapshot,
			paths: paths?.table() ?? null,
			subsongs: subsongs ? [...subsongs] : null,
			loaded: snapshot.length,
			total: totalCount,
			isLoading,
			error: null,
			...deriveIntensity(snapshot),
		});
	};

	// Rows are read at the timer rather than captured at the call, so a coalesced run publishes the
	// newest set and never a stale one.
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

	const absorb = (chunk: Chunk) => {
		rows.push(...chunk.rows);
		if (paths && chunk.paths) for (const path of chunk.paths) paths.add(path);
		if (subsongs && chunk.subsongs) subsongs.push(...chunk.subsongs);
	};

	try {
		const signal = (entry.controller as AbortController).signal;
		const first = await fetchChunk(source, 0, firstChunk, signal);
		absorb(first);

		const total = first.totalCount;
		publish(total, rows.length < total);
		if (rows.length >= total) return;

		const step = Number.isFinite(chunkSize) ? chunkSize : total - rows.length;
		const offsets = Array.from(
			{ length: Math.ceil((total - rows.length) / step) },
			(_, at) => rows.length + at * step,
		);

		// Chunks land out of order but rows may only grow in order, so a chunk waits here until the gap
		// in front of it is filled.
		const pending = new Map<number, Chunk>();
		const queue = [...offsets];
		let appended = 0;

		const drainInOrder = () => {
			while (appended < offsets.length && pending.has(offsets[appended])) {
				absorb(pending.get(offsets[appended]) as Chunk);
				pending.delete(offsets[appended]);
				appended += 1;
			}
		};

		const worker = async () => {
			while (queue.length > 0) {
				const offset = queue.shift() as number;
				pending.set(offset, await fetchChunk(source, offset, step, signal));
				drainInOrder();
				publishSoon(total, rows.length < total);
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(concurrency, queue.length) }, worker),
		);

		// The list can be shorter than it claimed if it was edited mid-load, so loading ends here rather
		// than when the count is reached.
		dropDeferred();
		publish(total, false);
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

export const loadPlaylist = (playlistId: string, itemCount: number) =>
	begin(playlistKey(playlistId, itemCount), itemCount, {
		kind: "playlist",
		playlistId,
	});

export const loadLibrary = (itemCount: number) =>
	begin(libraryKey(itemCount), itemCount, { kind: "library" });

function begin(key: string, itemCount: number, source: LoadSource) {
	const entry = entryFor(key);
	if (entry.isStarted) return key;

	entry.isStarted = true;
	entry.controller = new AbortController();
	evictIdle(key);

	emit(entry, { total: itemCount, isLoading: itemCount > 0, error: null });
	if (itemCount > 0) load(entry, source);

	return key;
}

export function subscribePlaylist(key: string, listener: () => void) {
	return entryFor(key).listeners.subscribe(listener);
}

export const playlistSnapshot = (key: string) =>
	entries.get(key)?.snapshot ?? EMPTY_PLAYLIST;
