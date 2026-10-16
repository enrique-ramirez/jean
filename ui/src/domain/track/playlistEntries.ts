import type { LibraryFailure } from "@/shared/api/fooJeanLibrary";
import type { JlibSpine } from "@/shared/api/jlib";
import type { StateDocument } from "@/shared/api/state";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import { EMPTY_COLUMNS } from "./fields";
import type { LibraryColumns } from "./libraryColumns";
import type { PathTable } from "./pathTable";

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

export interface LibraryFeed {
	kind: "library";
	structure: number;
	revision: number;
	snapshotId: string;
	apiVersion: number | null;
	spine: JlibSpine;
	isChecking: boolean;
}

export interface PlaylistFeed {
	kind: "playlist";
	structure: string;
	revision: string;
	isChecking: boolean;
	appendedChars: number;
}

type Feed = LibraryFeed | PlaylistFeed;

export type LibraryGeneration = Pick<
	StateDocument["library"],
	"structure" | "revision"
>;

export type PlaylistGeneration = Pick<PlaylistFeed, "structure" | "revision">;

export interface Entry {
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
	failure: null,
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

export const componentLibraryKey = (origin: string) => `component:${origin}`;

export const generationKey = (key: string, structure: number | string) =>
	`${key}:s${structure}`;

export const playlistKey = (playlistId: string, structure: string) =>
	generationKey(playlistId, structure);

export function entryFor(key: string): Entry {
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

export function emit(entry: Entry, patch: Partial<PlaylistSnapshot>) {
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

export const heldEntry = (key: string) => entries.get(key);

export const everyEntry = () => [...entries.values()];

export function begin(
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
