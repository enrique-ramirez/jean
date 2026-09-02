// Hand-written, not generated: beefweb's OpenAPI document describes 0.10, and
// the media library API and the absent-versus-empty fields are newer than it.

export type PlaybackState = "playing" | "paused" | "stopped";

// Decibels, -100..0, on foobar2000. `type` is what says so; another player may
// report a linear range.
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
	playlistId: string;
	playlistIndex: number;
	position: number;
}

export interface PlayerInfo {
	// `name` distinguishes foobar2000 from DeaDBeeF and is the one to branch on.
	// `title` is a display name and identical to it on foobar2000.
	name: string;
	title?: string;
	version: string;
	pluginVersion: string;
}

export interface PlayerOption {
	id: string;
	name?: string;
	type: "enum" | "bool";
	value: number | boolean;
	enumNames?: string[];
}

export interface Permissions {
	changePlaylists: boolean;
	changeOutput: boolean;
	changeClientConfig: boolean;
}

export interface PlayerState {
	activeItem: ActiveItem;
	info: PlayerInfo;
	options?: PlayerOption[];
	permissions: Permissions;
	// Deprecated for `options`, still sent, and still the only answer on an
	// older player.
	playbackMode: number;
	playbackModes: string[];
	playbackState: PlaybackState;
	volume: Volume;
}

// Closed on purpose: there is no autoplaylist flag, and `GET /playlists/{id}`
// returns these same six. `totalTime` reads 0.0 on foobar2000.
export interface PlaylistInfo {
	id: string;
	index: number;
	isCurrent: boolean;
	// Goes stale the moment anything edits the playlist, and no update event
	// corrects it. Re-read before doing arithmetic with it.
	itemCount: number;
	title: string;
	totalTime: number;
}

// One string per requested column, positionally. Indexed through `FIELD`.
export type TrackColumns = string[];

export interface PlaylistItemsResponse {
	offset: number;
	totalCount: number;
	// No id: position is the identity, so any mutation invalidates held indices.
	items: { columns: TrackColumns }[];
}

export interface TrackRows {
	rows: TrackColumns[];
	totalCount: number;
	offset: number;
}

// ---- the play queue --------------------------------------------------------

// Only what was explicitly queued: the player consumes an entry the moment its
// track starts, and offers no lookahead beyond that.
export interface PlayQueueItem {
	playlistId: string;
	playlistIndex: number;
	// Re-derived on every read, because the queue holds track handles rather than
	// positions. -1 once the track itself is removed from its playlist, and that
	// entry's `columns` are garbage rather than empty.
	itemIndex: number;
	columns: TrackColumns;
}

// ---- media library (beefweb 0.11+) ----------------------------------------

// Three states, not two: `supported: false` is 0.10 or DeaDBeeF, while
// `enabled: false` is a foobar2000 whose Media Library the user must configure.
export interface LibraryInfo {
	supported: boolean;
	enabled: boolean;
	itemCount: number;
}

export interface LibraryItem {
	// Relative to the media library folders and forward-slashed on every
	// platform, so it only matches the player's absolute path by suffix.
	path: string;
	// Non-zero for cue sheets and disc images.
	subsong: number;
	columns: TrackColumns;
}

export interface LibraryItemsResponse {
	offset: number;
	totalCount: number;
	items: LibraryItem[];
}

// Omitting both `items` and `query` means the whole library, which is the only
// way to send 30k tracks: naming them is a 2.9 MB body and beefweb hangs up
// over 1 MiB.
export interface AddFromLibraryBody {
	items?: { path: string; subsong: number }[];
	query?: string;
	index?: number;
	replace?: boolean;
	play?: boolean;
}

// ---- the update stream -----------------------------------------------------

// Change-driven, not a ticker: each message carries only what changed, and a
// long silence is normal.
export interface UpdateMessage {
	player?: PlayerState;
	playlists?: PlaylistInfo[];
	// Complete, unlike `playlists`: the whole queue arrives on every change to it.
	playQueue?: PlayQueueItem[];
}

// Kept with the moment it arrived, which is what makes the position
// interpolation anchor atomic.
export interface PlayerSnapshot {
	player: PlayerState;
	syncedAt: number;
}

export interface PlaybackPosition {
	playlistId: string | null;
	index: number;
}

// What the source seam matches on, deliberately separate from the track below:
// asking it for a full NowPlayingTrack would mean inventing an artist and a
// title to ask a question about a path.
export interface TrackIdentity {
	path: string | null;
	subsong: number;
}

export interface NowPlayingTrack extends TrackIdentity {
	artist: string;
	title: string;
}
