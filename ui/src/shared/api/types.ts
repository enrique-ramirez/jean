export type PlaybackState = "playing" | "paused" | "stopped";

// Jean's own playback-mode vocabulary, matching `contract/openapi.yaml`'s `PlaybackMode`. `foo_jean`
// maps it onto whatever the player calls its own orders, both ways; neither foobar2000's string nor
// its ordinal ever reaches here.
export type PlaybackMode =
	| "inOrder"
	| "repeatAll"
	| "repeatOne"
	| "random"
	| "shuffleTracks"
	| "shuffleAlbums"
	| "shuffleFolders";

// Decibels rather than a percentage, and `type` is what says so. The range is the player's:
// -100..0 on foobar2000, so read `min` and `max` rather than assuming it.
export interface Volume {
	type: string;
	min: number;
	max: number;
	value: number;
	isMuted: boolean;
}

export interface ActiveItem {
	columns: string[];
	duration: number;
	// -1 when stopped, and also what emptying a playlist leaves behind.
	index: number;
	path: string | null;
	// foobar2000's own playlist GUID, matching `PlaylistAnnotation.id`. Not beefweb's id, which stays
	// on `playlistId`.
	playlistGuid: string | null;
	playlistId: string;
	playlistIndex: number;
	position: number;
	subsong: number;
}

export interface PlayerInfo {
	name: string;
	version: string;
}

export interface Permissions {
	changePlaylists: boolean;
	changeOutput: boolean;
	changeClientConfig: boolean;
}

export interface PlayerState {
	activeItem: ActiveItem;
	info: PlayerInfo;
	permissions: Permissions;
	jeanPlaybackMode: PlaybackMode | null;
	playbackState: PlaybackState;
	volume: Volume;
}

export interface PlaylistInfo {
	id: string;
	index: number;
	isCurrent: boolean;
	// Goes stale the moment anything edits the playlist and no update event corrects it. Re-read it
	// before doing arithmetic with it.
	itemCount: number;
	title: string;
	totalTime: number;
}

export type TrackColumns = string[];

export interface PlaylistItemsResponse {
	offset: number;
	totalCount: number;
	// No id: position is the identity, so any mutation invalidates indices being held.
	items: { columns: TrackColumns }[];
}

export interface TrackRows {
	rows: TrackColumns[];
	totalCount: number;
	offset: number;
}

export interface PlayQueueItem {
	playlistId: string;
	playlistIndex: number;
	// The queue holds a track handle rather than a position, so this is re-derived on every read. -1
	// once the track is removed from its playlist, and that entry's columns are garbage, not empty.
	itemIndex: number;
	columns: TrackColumns;
}

export interface LibraryInfo {
	supported: boolean;
	enabled: boolean;
	itemCount: number;
}

export interface LibraryItem {
	// Relative to the library folders and forward-slashed on every platform. See `libraryPathMatcher`.
	path: string;
	subsong: number;
	columns: TrackColumns;
}

export interface LibraryNode {
	type: "D" | "F";
	name: string;
	path: string;
	itemCount?: number;
	subsong?: number;
	columns?: TrackColumns;
}

export interface LibraryNodesResponse {
	offset: number;
	totalCount: number;
	path: string;
	parentPath?: string;
	items: LibraryNode[];
}

// Omitting both `items` and `query` means the whole library, and is the only way to send a large one:
// naming every track exceeds the 1 MiB body beefweb accepts.
export interface AddFromLibraryBody {
	items?: { path: string; subsong: number }[];
	query?: string;
	index?: number;
	replace?: boolean;
	play?: boolean;
}

export interface UpdateMessage {
	player?: PlayerState;
	playlists?: PlaylistInfo[];
	// Complete, unlike `playlists`: the whole queue arrives on every change to it.
	playQueue?: PlayQueueItem[];
}

export interface PlayerSnapshot {
	player: PlayerState;
	syncedAt: number;
}

export interface PlaybackPosition {
	playlistId: string | null;
	index: number;
}

export interface TrackIdentity {
	path: string | null;
	subsong: number;
}

export interface NowPlayingTrack extends TrackIdentity {
	artist: string;
	title: string;
}
