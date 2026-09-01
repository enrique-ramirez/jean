import { fetchLibraryItems, fetchPlaylistItems } from "@/shared/api/beefweb";
import type { TrackColumns } from "@/shared/api/types";
import { TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity } from "./intensity";

// `paths` and `subsongs` are parallel to `rows` and present only on the media
// library, where a track has a real identity. Null on a playlist rather than
// empty, so reaching for them on the wrong source fails loudly.
export interface PlaylistSnapshot {
	rows: TrackColumns[];
	paths: string[] | null;
	subsongs: number[] | null;
	loaded: number;
	total: number;
	isLoading: boolean;
	error: Error | null;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

// Which of the two the loader is reading. The playlist one carries the id it
// reads from; the library has no playlist behind it at all.
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
	listeners: Set<() => void>;
	snapshot: PlaylistSnapshot;
	controller: AbortController | null;
	isStarted: boolean;
}

// Two servers with opposite costs. On a playlist almost all the cost is the
// round trip, so one modest chunk to paint and then as few large concurrent ones
// as the browser allows. The media library endpoint has no cache and
// re-enumerates on every call, so concurrency buys nothing there.
const STRATEGY = {
	playlist: { firstChunk: 2500, chunkSize: 7500, concurrency: 4 },
	library: { firstChunk: 500, chunkSize: Infinity, concurrency: 1 },
};

// One shared load per key: the library has several consumers and none may fetch
// its own copy.
//
// A load runs to completion even after every consumer unmounts -- the bytes are
// already paid for. What is kept afterwards is bounded, because rows are the
// largest thing Jean holds and browsing twenty playlists would otherwise retain
// twenty copies for the life of the tab.
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

// The media library has no playlist id, so it gets a key of its own -- still
// carrying the count, so an edited library loads afresh.
export const libraryKey = (itemCount: number) => `library:${itemCount}`;

// One shape for both, so the loading machinery below never asks which it is.
// `paths` and `subsongs` are null for a playlist, which has neither.
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
		// Re-inserted so the eviction below sees it as the most recent.
		entries.delete(key);
		entries.set(key, held);
		return held;
	}

	const entry: Entry = {
		key,
		listeners: new Set(),
		snapshot: EMPTY_PLAYLIST,
		controller: null,
		isStarted: false,
	};
	entries.set(key, entry);
	return entry;
}

function emit(entry: Entry, patch: Partial<PlaylistSnapshot>) {
	entry.snapshot = { ...entry.snapshot, ...patch };
	for (const listener of entry.listeners) listener();
}

const prefixOf = (key: string) => key.slice(0, key.indexOf(":"));

// A superseded entry -- same playlist, different item count -- is a stale copy
// of the largest thing in memory and always goes. The rest are merely old, and
// insertion order is recency. Either way nobody may be watching.
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
	const paths: string[] | null = isLibrary ? [] : null;
	const subsongs: number[] | null = isLibrary ? [] : null;

	const publish = (totalCount: number, isLoading: boolean) => {
		// A fresh array reference each time, so consumers re-render.
		const snapshot = [...rows];
		emit(entry, {
			rows: snapshot,
			// Null rather than empty off the library source, so a consumer reaching for it
			// on the wrong source fails loudly.
			paths: paths ? [...paths] : null,
			subsongs: subsongs ? [...subsongs] : null,
			loaded: snapshot.length,
			total: totalCount,
			isLoading,
			error: null,
			...deriveIntensity(snapshot),
		});
	};

	const absorb = (chunk: Chunk) => {
		rows.push(...chunk.rows);
		if (paths && chunk.paths) paths.push(...chunk.paths);
		if (subsongs && chunk.subsongs) subsongs.push(...chunk.subsongs);
	};

	try {
		const signal = (entry.controller as AbortController).signal;
		const first = await fetchChunk(source, 0, firstChunk, signal);
		absorb(first);

		const total = first.totalCount;
		publish(total, rows.length < total);
		if (rows.length >= total) return;

		// Infinity means "the rest in one request", which is what the library
		// wants: every extra call is another full enumeration.
		const step = Number.isFinite(chunkSize) ? chunkSize : total - rows.length;
		const offsets = Array.from(
			{ length: Math.ceil((total - rows.length) / step) },
			(_, at) => rows.length + at * step,
		);

		// Chunks land out of order but rows may only grow in order, so a chunk waits
		// here until the gap in front of it is filled.
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
				publish(total, rows.length < total);
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(concurrency, queue.length) }, worker),
		);

		// The list can be shorter than it claimed if it was edited mid-load, so loading
		// ends here rather than when the count is reached.
		publish(total, false);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		// Cleared so a later mount can try again rather than sitting on the failure
		// for as long as the tab is open.
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
	const entry = entryFor(key);
	entry.listeners.add(listener);
	return () => entry.listeners.delete(listener);
}

export const playlistSnapshot = (key: string) =>
	entries.get(key)?.snapshot ?? EMPTY_PLAYLIST;
