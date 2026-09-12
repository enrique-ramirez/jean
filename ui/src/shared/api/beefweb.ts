import { translate } from "@/shared/i18n/locale";
import type {
	LibraryNodesResponse,
	NowPlayingTrack,
	PlayerState,
	PlaylistInfo,
	PlaylistItemsResponse,
	PlayQueueItem,
	TrackColumns,
	TrackRows,
} from "./types";

// The player splits this list on commas before it evaluates anything, so a title-format function
// taking more than one argument is unusable -- $if(a,b,c) arrives as three columns. Single-argument
// functions do nest.
const TRACK_COLUMNS = ["%artist%", "%title%", "%path%", "%subsong%"];

const encode = (expressions: readonly string[]) =>
	encodeURIComponent(expressions.join(","));

const nowPlayingColumns = encode(TRACK_COLUMNS);

const QUEUE_COLUMNS = ["%artist%", "%title%", "%length_seconds%"];

export const QUEUE_FIELD = { artist: 0, title: 1, duration: 2 };

const queueColumns = encode(QUEUE_COLUMNS);

export const UPDATES_URL = `/api/query/updates?player=true&playlists=true&playQueue=true&trcolumns=${nowPlayingColumns}&qcolumns=${queueColumns}`;

const id = encodeURIComponent;

async function request(path: string, options?: RequestInit) {
	const response = await fetch(path, options);
	if (!response.ok)
		throw new Error(
			`${options?.method ?? "GET"} ${path} failed: ${response.status}`,
		);
	return response;
}

const post = (path: string, body?: unknown) =>
	request(path, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});

// `GET /api/player` ignores `trcolumns` and answers with an empty columns array.
export async function fetchPlayer(): Promise<PlayerState> {
	const response = await request(
		`/api/query?player=true&trcolumns=${nowPlayingColumns}`,
	);
	const { player } = (await response.json()) as { player: PlayerState };
	return player;
}

export async function fetchPlaylists(): Promise<PlaylistInfo[]> {
	const response = await request("/api/playlists");
	const { playlists } = (await response.json()) as {
		playlists: PlaylistInfo[];
	};
	return playlists;
}

// `GET /api/playqueue` takes a parameter named `columns`, ignores `qcolumns`, and answers
// `"columns": []` rather than an error.
export async function fetchPlayQueue(): Promise<PlayQueueItem[]> {
	const response = await request(
		`/api/query?playQueue=true&qcolumns=${queueColumns}`,
	);
	const { playQueue } = (await response.json()) as {
		playQueue: PlayQueueItem[];
	};
	return playQueue;
}

// One item per request: a bulk `items` array is a 400. `queueIndex` is accepted and silently ignored
// here, so this always appends.
export const addToPlayQueue = (playlistId: string, itemIndex: number) =>
	post("/api/playqueue/add", { plref: playlistId, itemIndex });

export const removeFromPlayQueue = (queueIndex: number) =>
	post("/api/playqueue/remove", { queueIndex });

export const clearPlayQueue = () => post("/api/playqueue/clear");

export async function fetchPlaylistItems(
	playlistId: string,
	offset: number,
	count: number,
	columns: string[],
	{ signal }: { signal?: AbortSignal } = {},
): Promise<TrackRows> {
	const response = await request(
		`/api/playlists/${id(playlistId)}/items/${offset}:${count}?columns=${encode(columns)}`,
		{ signal },
	);
	const { playlistItems } = (await response.json()) as {
		playlistItems: PlaylistItemsResponse;
	};
	return {
		rows: playlistItems.items.map((item) => item.columns),
		totalCount: playlistItems.totalCount,
		offset: playlistItems.offset,
	};
}

export const artworkUrl = (playlistId: string, index: number) =>
	`/api/artwork/${id(playlistId)}/${index}`;

// One folder of the library tree, which is how a client reaches one track by a path it holds. See
// README.md: an ordinal is not an offset into `/library/items`.
export async function fetchLibraryNodes(
	directory: string,
	columns: string[],
): Promise<LibraryNodesResponse> {
	const response = await request(
		`/api/library/items/by-path?path=${encodeURIComponent(directory)}&columns=${encode(columns)}`,
	);
	const { libraryNodes } = (await response.json()) as {
		libraryNodes: LibraryNodesResponse;
	};
	return libraryNodes;
}

export const playPause = () => post("/api/player/play-pause");

// The player says a track changed and never which direction it moved, so a skip has to be recorded
// where it is asked for. Taken rather than read, and stale after a moment: a skip the player never
// answers must not turn the next track that ends on its own into a step backwards.
const ASKED_MS = 4000;
let asked: { by: number; at: number } | null = null;

export function takeSkipAsked() {
	const last = asked;
	asked = null;
	return last && Date.now() - last.at < ASKED_MS ? last.by : null;
}

const skipping = (by: number) => {
	asked = { by, at: Date.now() };
};

export const nextTrack = () => {
	skipping(1);
	return post("/api/player/next");
};
export const previousTrack = () => {
	skipping(-1);
	return post("/api/player/previous");
};
export const stop = () => post("/api/player/stop");
export const playItem = (playlistId: string, index: number) =>
	post(`/api/player/play/${id(playlistId)}/${index}`);
export const seekTo = (position: number) => post("/api/player", { position });
export const seekBy = (offset: number) =>
	post("/api/player", { relativePosition: offset });
export const setVolume = (volume: number) => post("/api/player", { volume });
export const setMuted = (isMuted: boolean) => post("/api/player", { isMuted });

export const volumeUp = () => post("/api/player/volume/up");
export const volumeDown = () => post("/api/player/volume/down");

// foobar2000 carries the order as an option named `playbackOrder`. DeaDBeeF splits it into `shuffle`
// and `repeat` and answers `400 invalid option id` for that name, so there the only write that lands
// is the deprecated top-level field, which both players still accept.
export const setPlaybackOrder = (value: number, hasOrderOption: boolean) =>
	post(
		"/api/player",
		hasOrderOption
			? { options: [{ id: "playbackOrder", value }] }
			: { playbackMode: value },
	);

export async function createPlaylist(title: string): Promise<PlaylistInfo> {
	const response = await post(
		`/api/playlists/add?title=${encodeURIComponent(title)}`,
	);
	return response.json() as Promise<PlaylistInfo>;
}

export const renamePlaylist = (playlistId: string, title: string) =>
	post(`/api/playlists/${id(playlistId)}`, { title });
// Deleting a playlist the play queue points into crashes foo_beefweb and takes foobar2000 with it.
export const removePlaylist = (playlistId: string) =>
	post(`/api/playlists/remove/${id(playlistId)}`);
export const movePlaylist = (playlistId: string, index: number) =>
	post(`/api/playlists/move/${id(playlistId)}/${index}`);

// `items` is often a typed array, which `JSON.stringify` turns into an object. Hence the copy, here
// and in `removePlaylistItems`.
export const copyPlaylistItems = (
	sourceId: string,
	targetId: string,
	items: ArrayLike<number>,
) =>
	post(`/api/playlists/${id(sourceId)}/${id(targetId)}/items/copy`, {
		items: Array.from(items),
	});

export const clearPlaylist = (playlistId: string) =>
	post(`/api/playlists/${id(playlistId)}/clear`);

export const removePlaylistItems = (
	playlistId: string,
	items: ArrayLike<number>,
) =>
	post(`/api/playlists/${id(playlistId)}/items/remove`, {
		items: Array.from(items),
	});

export function readTrack(
	player: PlayerState | null | undefined,
): NowPlayingTrack | null {
	const values = player?.activeItem?.columns;
	if (!values?.length) return null;
	const [artist, title, path, subsong] = values;
	return {
		artist: artist || translate("track.unknownArtist"),
		title: title || translate("track.unknownTitle"),
		path: path || null,
		subsong: Number(subsong) || 0,
	};
}

export function libraryPathMatcher(absolute: string | null | undefined) {
	if (!absolute) return () => false;
	const flat = absolute.replaceAll("\\", "/");
	return (relative: string | null | undefined) =>
		Boolean(relative) && (flat === relative || flat.endsWith(`/${relative}`));
}

export async function fetchActiveItemColumns(
	expressions: string[],
): Promise<TrackColumns | null> {
	const response = await request(
		`/api/query?player=true&trcolumns=${encode(expressions)}`,
	);
	const { player } = (await response.json()) as { player: PlayerState };
	const item = player.activeItem;
	return item && item.index >= 0 ? (item.columns ?? null) : null;
}
