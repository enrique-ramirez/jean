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
	// -1 when stopped, and also when a track keeps playing but its row has been pulled from the
	// playlist it started in, so `foo_jean` has nothing to name. The two are not the same fact: a
	// reader asking whether something is playing wants `path` or `playbackState`, never this.
	index: number;
	path: string | null;
	// Library-relative and forward-slashed where the media library holds the playing track, `null`
	// where it does not. `path` above is foobar2000's own absolute one, which no route accepts.
	libraryPath: string | null;
	// The record the playing track is from, and its album artist, computed by the player and carried
	// on every poll: `null` where the player has not computed one. A cover is keyed by these, never
	// by the track, so an album played through costs one request.
	album: string | null;
	albumArtist: string | null;
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
	changeOutput: boolean;
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
	// A string of decimal digits, never a number: `shared/api/README.md` has why.
	structure: string;
	revision: string;
	// What `foo_jean` keeps the playlist for, `"scratch"` or `null`. Read from a marker the component
	// writes rather than from `title`, so it survives a rename at the player.
	role: "scratch" | null;
	isAutoPlaylist: boolean;
}

export type TrackColumns = string[];

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

// Omitting both `items` and `query` means the whole library, and is the only way to send a large one:
// naming every track exceeds the 1 MiB body beefweb accepts.
export interface AddFromLibraryBody {
	items?: { path: string; subsong: number }[];
	query?: string;
	index?: number;
	replace?: boolean;
	play?: boolean;
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

// The ways the player already holds a track, and what a tag write is addressed by. A library path
// names one track per media library root holding it, so the ordinal is the precise form beside it;
// a position moves, so both forms built on a generation carry the one they were read at.
export type TrackAddress =
	| { kind: "library"; track: string; subsong: number }
	| { kind: "ordinal"; ordinal: number; structure: number }
	| { kind: "playlist"; playlist: string; index: number; structure: string };

export interface NowPlayingTrack extends TrackIdentity {
	artist: string;
	title: string;
}
