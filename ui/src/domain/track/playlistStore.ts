import { fetchLibraryItems, fetchPlaylistItems } from "@/shared/api/beefweb";
import {
	fetchLibrary,
	fetchLibraryChanges,
	fetchLibraryState,
	type LibraryFailure,
	type LibraryFailureReason,
} from "@/shared/api/fooJeanLibrary";
import type { JlibDelta } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import { EMPTY_COLUMNS, TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity, INTENSITY_FIELDS } from "./intensity";
import {
	columnCollector,
	type LibraryColumns,
	someFieldMoved,
} from "./libraryColumns";
import { librarySnapshotOf, patchedColumns } from "./librarySnapshot";
import { type PathCollector, type PathTable, pathCollector } from "./pathTable";

// `paths` and `subsongs` are parallel to the columns and present only on the media library. Null
// rather than empty on a playlist, so reaching for them on the wrong source fails loudly.
export interface PlaylistSnapshot {
	columns: LibraryColumns;
	structure: number;
	paths: PathTable | null;
	subsongs: Int32Array | null;
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

interface Feed {
	structure: number;
	revision: number;
	tag: string | null;
	isChecking: boolean;
}

interface Entry {
	key: string;
	listeners: Subscribers;
	snapshot: PlaylistSnapshot;
	controller: AbortController | null;
	isStarted: boolean;
	feed: Feed | null;
}

const STRATEGY = {
	playlist: { firstChunk: 2500, chunkSize: 7500, concurrency: 4 },
	library: { firstChunk: 500, chunkSize: Infinity, concurrency: 1 },
};

const COALESCE_MS = 250;

const MAX_IDLE_ENTRIES = 4;

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
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

export const playlistKey = (playlistId: string, itemCount: number) =>
	`${playlistId}:${itemCount}`;

export const libraryKey = (itemCount: number) => `library:${itemCount}`;

export const componentLibraryKey = (origin: string) => `component:${origin}`;

export const generationKey = (key: string, structure: number) =>
	`${key}:s${structure}`;

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

	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	const paths: PathCollector | null = isLibrary ? pathCollector() : null;
	const subsongs: number[] | null = isLibrary ? [] : null;

	const publish = (totalCount: number, isLoading: boolean) => {
		const columns = collector.table();
		emit(entry, {
			columns,
			paths: paths?.table() ?? null,
			subsongs: subsongs ? Int32Array.from(subsongs) : null,
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

	const absorb = (chunk: Chunk) => {
		collector.add(chunk.rows);
		if (paths && chunk.paths) for (const path of chunk.paths) paths.add(path);
		if (subsongs && chunk.subsongs) subsongs.push(...chunk.subsongs);
	};

	try {
		const signal = (entry.controller as AbortController).signal;
		const first = await fetchChunk(source, 0, firstChunk, signal);
		absorb(first);

		const total = first.totalCount;
		publish(total, collector.count() < total);
		if (collector.count() >= total) return;

		const held = collector.count();
		const step = Number.isFinite(chunkSize) ? chunkSize : total - held;
		const offsets = Array.from(
			{ length: Math.ceil((total - held) / step) },
			(_, at) => held + at * step,
		);

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
				publishSoon(total, collector.count() < total);
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

const READ_FAILED = {
	unavailable: "library.readUnavailable",
	unauthorized: "library.readUnauthorized",
	"too-large": "library.readTooLarge",
	refused: "library.readRefused",
	unreachable: "library.readUnreachable",
	timeout: "library.readTimedOut",
	failed: "library.readFailed",
} as const satisfies Record<LibraryFailureReason, Phrase>;

const readError = (failure: LibraryFailure) => {
	const message = translate(READ_FAILED[failure.reason]);
	return new Error(
		failure.detail
			? translate("library.readDetail", { message, detail: failure.detail })
			: message,
	);
};

async function loadSnapshot(entry: Entry, origin: string, token: string) {
	try {
		const result = await fetchLibrary(
			origin,
			token,
			TRACK_EXPRESSIONS,
			(entry.controller as AbortController).signal,
		);

		if (!result.ok) {
			entry.isStarted = false;
			return emit(entry, { isLoading: false, error: readError(result) });
		}

		const { library } = result;
		const { columns, paths, subsongs } = librarySnapshotOf(
			library,
			TRACK_EXPRESSIONS,
		);

		entry.feed = {
			structure: library.structure,
			revision: library.revision,
			tag: null,
			isChecking: false,
		};

		emit(entry, {
			columns,
			structure: library.structure,
			paths,
			subsongs,
			loaded: columns.trackCount,
			total: columns.trackCount,
			isLoading: false,
			error: null,
			...deriveIntensity(columns),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		entry.isStarted = false;
		emit(entry, {
			isLoading: false,
			error: readError({
				ok: false,
				reason: "failed",
				detail: error instanceof Error ? error.message : "",
			}),
		});
	}
}

function exportAgain(entry: Entry, origin: string, token: string) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	emit(entry, { isLoading: true, error: null });
	return loadSnapshot(entry, origin, token);
}

function applyDelta(entry: Entry, feed: Feed, delta: JlibDelta) {
	const held = entry.snapshot.columns;
	const columns = patchedColumns(held, delta, TRACK_EXPRESSIONS);
	if (!columns) return false;

	feed.revision = delta.revision;
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? deriveIntensity(columns)
			: null),
	});
	return true;
}

export async function recheckComponentLibrary(origin: string, token: string) {
	const entry = entries.get(componentLibraryKey(origin));
	const feed = entry?.feed;
	if (!entry || !feed || feed.isChecking || entry.snapshot.isLoading) return;

	feed.isChecking = true;
	try {
		const answer = await fetchLibraryState(origin, token, feed.tag);
		if (!answer.ok || answer.kind === "unchanged") return;

		feed.tag = answer.tag;
		const { structure, revision } = answer.state;
		if (structure !== feed.structure)
			return void (await exportAgain(entry, origin, token));
		if (revision <= feed.revision) return;

		const changes = await fetchLibraryChanges(origin, token, feed.revision);
		if (!changes.ok) return;
		if (changes.kind === "delta" && applyDelta(entry, feed, changes.delta))
			return;

		await exportAgain(entry, origin, token);
	} finally {
		feed.isChecking = false;
	}
}

export const loadPlaylist = (playlistId: string, itemCount: number) =>
	begin(playlistKey(playlistId, itemCount), itemCount, itemCount > 0, (entry) =>
		load(entry, { kind: "playlist", playlistId }),
	);

export const loadLibrary = (itemCount: number) =>
	begin(libraryKey(itemCount), itemCount, itemCount > 0, (entry) =>
		load(entry, { kind: "library" }),
	);

export const loadComponentLibrary = (origin: string, token: string) =>
	begin(componentLibraryKey(origin), 0, true, (entry) =>
		loadSnapshot(entry, origin, token),
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
