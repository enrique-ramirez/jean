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
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

export type LibraryGeneration = Pick<
	StateDocument["library"],
	"structure" | "revision"
>;

export interface Entry {
	key: string;
	listeners: Subscribers;
	snapshot: PlaylistSnapshot;
	isStarted: boolean;
}

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

export const generationKey = (key: string, structure: number | string) =>
	`${key}:s${structure}`;

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
		isStarted: false,
	};
	entries.set(key, entry);
	return entry;
}

export function emit(entry: Entry, patch: Partial<PlaylistSnapshot>) {
	entry.snapshot = { ...entry.snapshot, ...patch };
	entry.listeners.notify();
}

export function subscribePlaylist(key: string, listener: () => void) {
	return entryFor(key).listeners.subscribe(listener);
}

export const playlistSnapshot = (key: string) =>
	entries.get(key)?.snapshot ?? EMPTY_PLAYLIST;
