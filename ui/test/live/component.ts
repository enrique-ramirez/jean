import type {
	PlaybackMode,
	PlaybackState,
} from "../../src/shared/api/types.ts";

export type { PlaybackMode };

// Reaching foo_jean from node, beside the browser Jean is driven in. The origin comes from the
// environment so nothing here names a machine.

export const COMPONENT = () => {
	const live = process.env.LIVE;
	if (!live)
		throw new Error("LIVE must name the origin foo_jean serves Jean from.");
	return new URL(live).origin;
};

export const component = async <T>(
	path: string,
	init?: RequestInit,
): Promise<T> => {
	const response = await fetch(`${COMPONENT()}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
	const body = await response.text();
	if (!response.ok)
		throw new Error(
			`${init?.method ?? "GET"} ${path} -> ${response.status} ${body}`,
		);
	return (body ? JSON.parse(body) : undefined) as T;
};

export interface Playlist {
	id: string;
	index: number;
	title: string;
	itemCount: number;
	isAutoPlaylist: boolean;
	role: string | null;
	structure: string;
	revision: string;
}

export const playlists = () =>
	component<{ playlists: Playlist[] }>("/api/playlists").then(
		(answer) => answer.playlists,
	);

export const byTitle = async (title: string) => {
	const found = (await playlists()).find((entry) => entry.title === title);
	if (!found) throw new Error(`no playlist titled ${title}`);
	return found;
};

export const rowsOf = (id: string, offset: number, count: number) =>
	component<{
		items: { columns: string[]; libraryPath: string | null }[];
		totalCount: number;
		structure: string;
		revision: string;
	}>(
		`/api/playlists/${id}/items?offset=${offset}&count=${count}&columns=${encodeURIComponent("%path%")}`,
	);

export const writeRating = (
	address: { track: string; subsong?: number },
	rating: string,
) =>
	component("/api/tags", {
		method: "POST",
		body: JSON.stringify({ ...address, fields: { rating } }),
	});

export const capabilities = () =>
	component<{
		canWrite: boolean;
		canWritePlaylists: boolean;
		allowedFields: string[];
		playbackModes: PlaybackMode[];
	}>("/api/capabilities");

export const copyToNewPlaylist = (
	title: string,
	source: string,
	rows: number,
) =>
	component<Playlist>("/api/playlists", {
		method: "POST",
		body: JSON.stringify({ title, source, runs: [[0, rows]] }),
	});

export const removePlaylist = (id: string) =>
	component<void>(`/api/playlists/${id}`, { method: "DELETE" });

export const playRow = (id: string, index: number) =>
	component<void>(`/api/playlists/${id}/items/${index}/play`, {
		method: "POST",
	});

export const send = (path: string, body?: unknown) =>
	component<void>(path, {
		method: "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

export interface PlayerState {
	playback: PlaybackState;
	path: string;
	subsong: number;
	libraryPath: string | null;
	position: { seconds: number; ageSeconds: number };
	volume: number;
	muted: boolean;
	playbackMode: PlaybackMode;
	title: string | null;
	artist: string | null;
	playingLocation: { playlistId: string; index: number } | null;
	currentPlaylistId: string | null;
}

export const state = () =>
	component<{ player: PlayerState; library: { ready: boolean } }>("/api/state");

export const player = async () => (await state()).player;
