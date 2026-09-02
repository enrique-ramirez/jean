import type {
	AddFromLibraryBody,
	LibraryInfo,
	LibraryItemsResponse,
	NowPlayingTrack,
	PlayerState,
	PlaylistInfo,
	PlaylistItemsResponse,
	PlayQueueItem,
	TrackRows,
} from "./types";

// Title-formatting expressions, evaluated by the player and returned
// positionally, so adding a field needs no support on beefweb's side.
// Multi-argument functions are unusable -- the list is split on commas before
// evaluation, so $if(a,b,c) arrives as three columns -- but single-argument ones
// nest.
//
// %path% and %subsong% are here for identity rather than display. This is the
// active item only, one string per player update, which is why the "never hold
// per-track-unique strings" rule does not apply.
const TRACK_COLUMNS = ["%artist%", "%title%", "%path%", "%subsong%"];

const encode = (expressions: readonly string[]) =>
	encodeURIComponent(expressions.join(","));

const nowPlayingColumns = encode(TRACK_COLUMNS);

// Three, not the track list's fourteen: the stream re-sends the whole queue on
// every change to it and the player re-evaluates each expression.
const QUEUE_COLUMNS = ["%artist%", "%title%", "%length_seconds%"];

export const QUEUE_FIELD = { artist: 0, title: 1, duration: 2 };

const queueColumns = encode(QUEUE_COLUMNS);

// Change-driven stream: beefweb pushes on track change, pause, volume and
// playlist edits, not on a timer. Long silences are normal, not a stall.
export const UPDATES_URL = `/api/query/updates?player=true&playlists=true&playQueue=true&trcolumns=${nowPlayingColumns}&qcolumns=${queueColumns}`;

// Ids come from the player, but they are still interpolated into a URL, and a
// path that escapes its segment would address a different endpoint.
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

// Through /api/query rather than /api/player: the latter ignores trcolumns and
// hands back an empty columns array.
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

// Through /api/query for the same reason as the player: `GET /api/playqueue`
// takes a parameter named `columns` and ignores `qcolumns`, answering with
// `"columns": []`.
export async function fetchPlayQueue(): Promise<PlayQueueItem[]> {
	const response = await request(
		`/api/query?playQueue=true&qcolumns=${queueColumns}`,
	);
	const { playQueue } = (await response.json()) as {
		playQueue: PlayQueueItem[];
	};
	return playQueue;
}

// One item per request; a bulk `items` array is a 400. `queueIndex` is accepted
// and silently ignored on foobar2000, so this always appends.
export const addToPlayQueue = (playlistId: string, itemIndex: number) =>
	post("/api/playqueue/add", { plref: playlistId, itemIndex });

// By queue position, which foobar2000 does honour here -- unlike on add.
export const removeFromPlayQueue = (queueIndex: number) =>
	post("/api/playqueue/remove", { queueIndex });

export const clearPlayQueue = () => post("/api/playqueue/clear");

// Raw positional column arrays rather than objects: markedly lighter at 30k+
// rows, and the shape dictionary encoding will want.
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
// Absent before 0.11 and on DeaDBeeF, where every endpoint below answers 501.
// `fetchLibraryInfo` always answers, because it is how a client finds out which
// of those it is talking to.

export async function fetchLibraryInfo(): Promise<LibraryInfo> {
	const response = await fetch("/api/library/info");
	// A released beefweb has no such route at all. Same answer as 501: no library
	// here, fall back to the autoplaylist.
	if (response.status === 404 || response.status === 501) {
		return { supported: false, enabled: false, itemCount: 0 };
	}
	if (!response.ok)
		throw new Error(`GET /api/library/info failed: ${response.status}`);
	const { library } = (await response.json()) as { library: LibraryInfo };
	return library;
}

// The endpoint already defaults to file path, so this changes nothing on its
// own. It is named so the sort Jean applies to a playlist it just filled is
// demonstrably the expression it read the library with, rather than two defaults
// that happen to agree today.
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

// `items` rather than `query`: the player's syntax and Jean's fold()-based
// matching do not return the same set.
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

// The player owns the step size for these, which is why they are endpoints
// rather than a relativeVolume value picked here.
export const volumeUp = () => post("/api/player/volume/up");
export const volumeDown = () => post("/api/player/volume/down");

// playbackMode is deprecated in the spec; the options array is the current form.
export const setPlaybackOrder = (value: number) =>
	post("/api/player", { options: [{ id: "playbackOrder", value }] });

// Returns the new playlist, id included, so nothing has to guess which of the
// player's playlists just appeared.
export async function createPlaylist(title: string): Promise<PlaylistInfo> {
	const response = await post(
		`/api/playlists/add?title=${encodeURIComponent(title)}`,
	);
	return response.json() as Promise<PlaylistInfo>;
}

// The three ways a playlist itself changes, as opposed to its contents. A
// negative move index means "last", per the spec.
export const renamePlaylist = (playlistId: string, title: string) =>
	post(`/api/playlists/${id(playlistId)}`, { title });
export const removePlaylist = (playlistId: string) =>
	post(`/api/playlists/remove/${id(playlistId)}`);
export const movePlaylist = (playlistId: string, index: number) =>
	post(`/api/playlists/move/${id(playlistId)}/${index}`);

// By index, so this uploads nothing but numbers at any size. `items` is often a
// typed array, which JSON.stringify would turn into an object -- hence the copy.
export const copyPlaylistItems = (
	sourceId: string,
	targetId: string,
	items: ArrayLike<number>,
) =>
	post(`/api/playlists/${id(sourceId)}/${id(targetId)}/items/copy`, {
		items: Array.from(items),
	});

// Empties without deleting. Deleting a playlist the play queue points into
// crashes foo_beefweb and takes foobar2000 with it.
export const clearPlaylist = (playlistId: string) =>
	post(`/api/playlists/${id(playlistId)}/clear`);

// Index is identity, so this only means anything against a list nobody has
// touched since the indices were worked out. See useAddTracks for the check.
export const removePlaylistItems = (
	playlistId: string,
	items: ArrayLike<number>,
) =>
	post(`/api/playlists/${id(playlistId)}/items/remove`, {
		items: Array.from(items),
	});

// Maps the positional columns array back onto names.
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

// The player reports an absolute path; the media library reports one relative to
// the library folders, forward-slashed. Jean is never told where those folders
// are, so the two are matched by suffix -- safe, because a relative path is
// unique within the library.
//
// A matcher rather than a predicate, because the caller asks the same question
// of every path in the library in a row.
export function libraryPathMatcher(absolute: string | null | undefined) {
	if (!absolute) return () => false;
	const flat = absolute.replaceAll("\\", "/");
	return (relative: string | null | undefined) =>
		Boolean(relative) && (flat === relative || flat.endsWith(`/${relative}`));
}
