import {
	fetchPlaylistItemChanges,
	fetchPlaylistRows,
	fetchState,
	type PlaylistChanges,
	type StateDocument,
} from "@/shared/api/fooJean";
import {
	fetchLibrary,
	fetchLibraryChanges,
	type LibraryFailure,
	type LibraryFailureReason,
} from "@/shared/api/fooJeanLibrary";
import { type JlibDelta, patchColumn } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
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

// Null rather than empty on a playlist, so reaching for them on the wrong source fails loudly.
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

interface Chunk {
	rows: TrackColumns[];
	// The empty string where the row's track is not in the library, matching how `PathTable` already
	// answers an out-of-range ref: nothing for `artworkUrl` to draw from.
	paths: string[];
	totalCount: number;
	structure: number;
	revision: number;
}

interface Feed {
	structure: number;
	revision: number;
	isChecking: boolean;
}

// README.md: a `{structure, revision}` pair compares for equality only, never order.
type LibraryGeneration = Pick<
	StateDocument["library"],
	"structure" | "revision"
>;

interface Entry {
	key: string;
	listeners: Subscribers;
	snapshot: PlaylistSnapshot;
	controller: AbortController | null;
	isStarted: boolean;
	feed: Feed | null;
	missedLibrary: LibraryGeneration | null;
}

const FIRST_CHUNK = 2500;
const CHUNK_SIZE = 7500;
const CONCURRENCY = 4;

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

export const componentLibraryKey = (origin: string) => `component:${origin}`;

export const generationKey = (key: string, structure: number) =>
	`${key}:s${structure}`;

export const playlistKey = (playlistId: string, structure: number) =>
	generationKey(playlistId, structure);

const fetchChunk = async (
	origin: string,
	token: string,
	playlistId: string,
	offset: number,
	count: number,
	signal: AbortSignal,
): Promise<Chunk> => {
	const page = await fetchPlaylistRows(
		origin,
		token,
		playlistId,
		offset,
		count,
		TRACK_EXPRESSIONS,
		{ signal },
	);
	return {
		rows: page.items.map((item) => item.columns),
		paths: page.items.map((item) => item.libraryPath ?? ""),
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

async function load(
	entry: Entry,
	origin: string,
	token: string,
	playlistId: string,
) {
	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	const paths = pathCollector();

	const addChunk = (chunk: Chunk) => {
		collector.add(chunk.rows);
		for (const path of chunk.paths) paths.add(path);
	};

	const publish = (totalCount: number, isLoading: boolean) => {
		const columns = collector.table();
		emit(entry, {
			columns,
			paths: paths.table(),
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
		const first = await fetchChunk(
			origin,
			token,
			playlistId,
			0,
			FIRST_CHUNK,
			signal,
		);
		addChunk(first);
		entry.feed = {
			structure: first.structure,
			revision: first.revision,
			isChecking: false,
		};

		const total = first.totalCount;
		publish(total, collector.count() < total);
		if (collector.count() >= total) return;

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
					await fetchChunk(
						origin,
						token,
						playlistId,
						offset,
						CHUNK_SIZE,
						signal,
					),
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
			isChecking: false,
		};

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
			...deriveIntensity(columns),
		});

		await recheckMissed(entry, origin, token);
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

function reloadPlaylist(
	entry: Entry,
	origin: string,
	token: string,
	playlistId: string,
) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	emit(entry, { isLoading: true, error: null });
	return load(entry, origin, token, playlistId);
}

function patchedPlaylistColumns(
	held: LibraryColumns,
	items: PlaylistChanges["items"],
): LibraryColumns | null {
	const ordinals = Uint32Array.from(items, (row) => row.position);

	const fields: LibraryColumns["fields"][number][] = [];
	for (let index = 0; index < held.fields.length; index += 1) {
		const field = held.fields[index];
		const appended = items.map((row) => row.columns[index]);
		const base = field.distinct;
		const patched = patchColumn(field, {
			ordinals,
			ids: Uint32Array.from(appended, (_, at) => base + at),
			base,
			appended,
			distinct: base + appended.length,
			hasUnresolved: false,
			allUnresolved: false,
		});
		if (!patched) return null;
		fields.push(patched);
	}

	return { ...held, fields };
}

function fitsHeldPaths(
	paths: PathTable | null,
	items: PlaylistChanges["items"],
): boolean {
	return items.every(
		(row) => (paths?.at(row.position) ?? "") === (row.libraryPath ?? ""),
	);
}

function applyPlaylistChanges(
	entry: Entry,
	feed: Feed,
	changes: PlaylistChanges,
): boolean {
	if (!fitsHeldPaths(entry.snapshot.paths, changes.items)) return false;

	if (changes.items.length === 0) {
		feed.revision = changes.revision;
		return true;
	}

	const held = entry.snapshot.columns;
	const columns = patchedPlaylistColumns(held, changes.items);
	if (!columns) return false;

	feed.revision = changes.revision;
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? deriveIntensity(columns)
			: null),
	});
	return true;
}

function applyDelta(entry: Entry, feed: Feed, delta: JlibDelta) {
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

async function recheckMissed(entry: Entry, origin: string, token: string) {
	const missed = entry.missedLibrary;
	if (!missed) return;
	entry.missedLibrary = null;

	const feed = entry.feed;
	if (
		feed &&
		missed.structure === feed.structure &&
		missed.revision === feed.revision
	)
		return;

	const result = await fetchState(origin, token, null);
	if (result.ok && result.kind === "state")
		await recheckComponentLibrary(origin, token, result.state.library);
}

export async function recheckComponentLibrary(
	origin: string,
	token: string,
	library: LibraryGeneration,
) {
	const entry = entries.get(componentLibraryKey(origin));
	if (!entry) return;

	const feed = entry.feed;
	if (!feed || feed.isChecking || entry.snapshot.isLoading) {
		entry.missedLibrary = library;
		return;
	}

	feed.isChecking = true;
	try {
		if (library.structure !== feed.structure)
			return void (await exportAgain(entry, origin, token));
		if (library.revision <= feed.revision) return;

		const changes = await fetchLibraryChanges(origin, token, feed.revision);
		if (!changes.ok) return;
		if (changes.kind === "delta" && applyDelta(entry, feed, changes.delta))
			return;

		await exportAgain(entry, origin, token);
	} finally {
		feed.isChecking = false;
		await recheckMissed(entry, origin, token);
	}
}

export const loadPlaylist = (
	origin: string,
	token: string,
	playlistId: string,
	structure: number,
	itemCount: number,
) =>
	begin(playlistKey(playlistId, structure), itemCount, itemCount > 0, (entry) =>
		load(entry, origin, token, playlistId),
	);

export async function recheckPlaylist(
	origin: string,
	token: string,
	playlistId: string,
	generation: { structure: number; revision: number },
) {
	const entry = entries.get(playlistKey(playlistId, generation.structure));
	const feed = entry?.feed;
	if (!entry || !feed || feed.isChecking) return;
	// The entry's own generation, read from the rows response rather than assumed from the key, can
	// still be ahead of what the caller believes: a structural edit landing between the caller reading
	// the list and this entry's own fetch completing. A fresh key for the new structure is what
	// resolves that, not a patch here.
	if (generation.structure !== feed.structure) return;
	if (generation.revision <= feed.revision) return;

	feed.isChecking = true;
	try {
		const result = await fetchPlaylistItemChanges(
			origin,
			token,
			playlistId,
			feed.structure,
			feed.revision,
			TRACK_EXPRESSIONS,
		);

		if (!result.ok || !applyPlaylistChanges(entry, feed, result.changes))
			return void (await reloadPlaylist(entry, origin, token, playlistId));
	} finally {
		feed.isChecking = false;
	}
}

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
