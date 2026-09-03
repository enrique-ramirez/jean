import type {
	AddFromLibraryBody,
	LibraryInfo,
	LibraryItemsResponse,
	NowPlayingTrack,
	PlayerState,
	PlaylistInfo,
	PlaylistItemsResponse,
	PlayQueueItem,
	TrackColumns,
	TrackRows,
} from "./types";

// Title-formatting expressions, evaluated by the player and returned positionally.
// Multi-argument functions are unusable: the list is split on commas before evaluation, so $if(a,b,c) arrives as three columns. Single-argument ones nest.
// %path% and %subsong% are here for identity rather than display.
const TRACK_COLUMNS = ["%artist%", "%title%", "%path%", "%subsong%"];

const encode = (expressions: readonly string[]) =>
	encodeURIComponent(expressions.join(","));

const nowPlayingColumns = encode(TRACK_COLUMNS);

// Kept short: the stream re-sends the whole queue on every change and the player re-evaluates each expression.
const QUEUE_COLUMNS = ["%artist%", "%title%", "%length_seconds%"];

export const QUEUE_FIELD = { artist: 0, title: 1, duration: 2 };

const queueColumns = encode(QUEUE_COLUMNS);

// Change-driven, not a timer: beefweb pushes on track change, pause, volume and playlist edits, so long silences are normal.
export const UPDATES_URL = `/api/query/updates?player=true&playlists=true&playQueue=true&trcolumns=${nowPlayingColumns}&qcolumns=${queueColumns}`;

// Ids come from the player but are still interpolated into a URL, and one that escaped its segment would address a different endpoint.
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

// Through /api/query rather than /api/player, which ignores `trcolumns` and hands back an empty columns array.
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

// Through /api/query for the same reason as the player: `GET /api/playqueue` takes a parameter named `columns`, ignores `qcolumns`, and answers `"columns": []`.
export async function fetchPlayQueue(): Promise<PlayQueueItem[]> {
	const response = await request(
		`/api/query?playQueue=true&qcolumns=${queueColumns}`,
	);
	const { playQueue } = (await response.json()) as {
		playQueue: PlayQueueItem[];
	};
	return playQueue;
}

// One item per request; a bulk `items` array is a 400. `queueIndex` is accepted and silently ignored on foobar2000, so this always appends.
export const addToPlayQueue = (playlistId: string, itemIndex: number) =>
	post("/api/playqueue/add", { plref: playlistId, itemIndex });

// By queue position, which foobar2000 does honour here, unlike on add.
export const removeFromPlayQueue = (queueIndex: number) =>
	post("/api/playqueue/remove", { queueIndex });

export const clearPlayQueue = () => post("/api/playqueue/clear");

// Raw positional column arrays rather than objects, which is markedly lighter at library scale.
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

// ---- media library (beefweb 0.11+) ----------------------------------------
//
// Absent before 0.11 and on DeaDBeeF, where every endpoint below answers 501. `fetchLibraryInfo` always answers, because it is how a client finds out which it is talking to.

export async function fetchLibraryInfo(): Promise<LibraryInfo> {
	const response = await fetch("/api/library/info");
	// A released beefweb has no such route. Same answer as 501: no library here, fall back to the autoplaylist.
	if (response.status === 404 || response.status === 501) {
		return { supported: false, enabled: false, itemCount: 0 };
	}
	if (!response.ok)
		throw new Error(`GET /api/library/info failed: ${response.status}`);
	const { library } = (await response.json()) as { library: LibraryInfo };
	return library;
}

// Named so the sort Jean applies to a playlist it just filled is demonstrably the expression it read the library with.
export const LIBRARY_SORT = "%path%";

export async function fetchLibraryItems({
	columns,
	offset,
	count,
	signal,
}: {
	columns: string[];
	offset?: number;
	count?: number | null;
	signal?: AbortSignal;
}): Promise<LibraryItemsResponse> {
	const range = count == null ? "" : `&range=${offset}:${count}`;
	const response = await request(
		`/api/library/items?columns=${encode(columns)}&sort=${encodeURIComponent(LIBRARY_SORT)}${range}`,
		{ signal },
	);
	const { libraryItems } = (await response.json()) as {
		libraryItems: LibraryItemsResponse;
	};
	return libraryItems;
}

export const libraryArtworkUrl = (path: string, subsong?: number) =>
	`/api/artwork/library?path=${encodeURIComponent(path)}` +
	(subsong ? `&subsong=${subsong}` : "");

// `items` rather than `query`: the player's syntax and Jean's fold()-based matching do not return the same set.
export const addFromLibrary = (playlistId: string, body: AddFromLibraryBody) =>
	post(`/api/playlists/${id(playlistId)}/items/add-from-library`, body);

export const sortPlaylistItems = (playlistId: string, by: string) =>
	post(`/api/playlists/${id(playlistId)}/items/sort`, { by });

export const playPause = () => post("/api/player/play-pause");
export const nextTrack = () => post("/api/player/next");
export const previousTrack = () => post("/api/player/previous");
export const stop = () => post("/api/player/stop");
export const playItem = (playlistId: string, index: number) =>
	post(`/api/player/play/${id(playlistId)}/${index}`);
export const seekTo = (position: number) => post("/api/player", { position });
export const seekBy = (offset: number) =>
	post("/api/player", { relativePosition: offset });
export const setVolume = (volume: number) => post("/api/player", { volume });
export const setMuted = (isMuted: boolean) => post("/api/player", { isMuted });

// The player owns the step size, which is why these are endpoints rather than a `relativeVolume` picked here.
export const volumeUp = () => post("/api/player/volume/up");
export const volumeDown = () => post("/api/player/volume/down");

export const setPlaybackOrder = (value: number) =>
	post("/api/player", { options: [{ id: "playbackOrder", value }] });

export async function createPlaylist(title: string): Promise<PlaylistInfo> {
	const response = await post(
		`/api/playlists/add?title=${encodeURIComponent(title)}`,
	);
	return response.json() as Promise<PlaylistInfo>;
}

// A negative move index means "last", per the spec.
export const renamePlaylist = (playlistId: string, title: string) =>
	post(`/api/playlists/${id(playlistId)}`, { title });
export const removePlaylist = (playlistId: string) =>
	post(`/api/playlists/remove/${id(playlistId)}`);
export const movePlaylist = (playlistId: string, index: number) =>
	post(`/api/playlists/move/${id(playlistId)}/${index}`);

// `items` is often a typed array, which `JSON.stringify` would turn into an object, hence the copy.
export const copyPlaylistItems = (
	sourceId: string,
	targetId: string,
	items: ArrayLike<number>,
) =>
	post(`/api/playlists/${id(sourceId)}/${id(targetId)}/items/copy`, {
		items: Array.from(items),
	});

// Empties without deleting: deleting a playlist the play queue points into crashes foo_beefweb and takes foobar2000 with it.
export const clearPlaylist = (playlistId: string) =>
	post(`/api/playlists/${id(playlistId)}/clear`);

// Index is identity, so this only means anything against a list nobody has touched since the indices were worked out.
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
		artist: artist || "Unknown artist",
		title: title || "Unknown title",
		path: path || null,
		subsong: Number(subsong) || 0,
	};
}

// The player reports an absolute path; the media library reports one relative to the library folders, forward-slashed.
// Jean is never told where those folders are, so the two are matched by suffix, which is unique within a library.
export function libraryPathMatcher(absolute: string | null | undefined) {
	if (!absolute) return () => false;
	const flat = absolute.replaceAll("\\", "/");
	return (relative: string | null | undefined) =>
		Boolean(relative) && (flat === relative || flat.endsWith(`/${relative}`));
}

// The active item against an arbitrary expression list, kept out of `UPDATES_URL` because the player re-evaluates that on every push.
// The caller must verify the identity it gets back: this reports whatever is playing now, not the track that was asked about.
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
