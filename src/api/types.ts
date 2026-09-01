// The shapes beefweb actually returns, hand-written from API.md and the
// measurements behind it. Nothing here is generated: the plugin ships an
// OpenAPI document, but it describes 0.10 and the parts Jean leans on hardest
// -- the media library API, and the fields that are absent rather than empty --
// are either newer than it or not expressible in it.
//
// The rule this file exists to enforce is the one in CLAUDE.md: `PlaylistInfo`
// has exactly six fields and there is no autoplaylist flag. Writing that down
// as a closed type is the cheapest way to stop the next person going looking
// for one.

export type PlaybackState = "playing" | "paused" | "stopped";

// Decibels on foobar2000, -100..0. `type` is what says so, and another player
// is allowed to report a linear range -- see src/player/volume.ts.
export interface Volume {
	type: string;
	min: number;
	max: number;
	value: number;
	isMuted: boolean;
}

// `index` is -1 when stopped, which is also what an emptied playlist leaves
// behind, so it is checked rather than assumed non-negative.
export interface ActiveItem {
	columns: string[];
	duration: number;
	index: number;
	playlistId: string;
	playlistIndex: number;
	position: number;
}

export interface PlayerInfo {
	// `name` is what distinguishes foobar2000 from DeaDBeeF, and is the one to
	// branch on. `title` is the same string on foobar2000 and is a display name
	// rather than an identity -- it is here because the captured player sends it
	// and API.md's three-field summary was short by one.
	name: string;
	title?: string;
	version: string;
	pluginVersion: string;
}

// Toggleable player options. `playbackOrder` is the enum one that matters;
// beefweb also reports bool options such as `stopAfterCurrentTrack`, and the
// set is the player's rather than a fixed list, so this stays open.
export interface PlayerOption {
	id: string;
	// The player's own label for the option, sent alongside the id.
	name?: string;
	type: "enum" | "bool";
	value: number | boolean;
	enumNames?: string[];
}

// From the player, not from Jean. A read-only instance has to get a read-only
// UI rather than buttons that come back 403.
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
	// Deprecated in the spec in favour of `options`, still sent, and still the
	// only answer on an older player.
	playbackMode: number;
	playbackModes: string[];
	playbackState: PlaybackState;
	volume: Volume;
}

// Exactly six fields. There is no flag distinguishing an autoplaylist from an
// ordinary one, `GET /playlists/{id}` returns the same six, and `totalTime`
// reads 0.0 on foobar2000 -- do not rely on it. `itemCount` goes stale the
// moment anything edits the playlist and nothing in the update stream corrects
// it; re-read it before doing arithmetic with it.
export interface PlaylistInfo {
	id: string;
	index: number;
	isCurrent: boolean;
	itemCount: number;
	title: string;
	totalTime: number;
}

// One string per requested column, positionally. Indexed through `FIELD` in
// src/playlist/fields.ts rather than by number at the call site.
export type TrackColumns = string[];

export interface PlaylistItemsResponse {
	offset: number;
	totalCount: number;
	// Items carry no id -- position is the identity, so any mutation
	// invalidates indices being held.
	items: { columns: TrackColumns }[];
}

// What `fetchPlaylistItems` narrows the above to: the columns lifted out,
// because one array of strings per track is markedly lighter at 30k rows.
export interface TrackRows {
	rows: TrackColumns[];
	totalCount: number;
	offset: number;
}

// ---- media library (beefweb 0.11+) ----------------------------------------

// `supported: false` is both "released 0.10, no such route" and "DeaDBeeF,
// 501". `enabled: false` is a third thing -- a foobar2000 with the API but no
// Media Library configured -- and the user fixes that one in foobar's own
// preferences, not in Jean.
export interface LibraryInfo {
	supported: boolean;
	enabled: boolean;
	itemCount: number;
}

// A track is `(path, subsong)`: subsong is non-zero for cue sheets and disc
// images, so it is not decoration. `path` is relative to the media library
// folders and forward-slashed on every platform, which is why it can only be
// matched against the player's absolute path by suffix.
export interface LibraryItem {
	path: string;
	subsong: number;
	columns: TrackColumns;
}

export interface LibraryItemsResponse {
	offset: number;
	totalCount: number;
	items: LibraryItem[];
}

// The body of `POST /playlists/{id}/items/add-from-library`. Omitting both
// `items` and `query` means the whole library, which is the only way to send
// 30k tracks at all: naming them explicitly is a 2.9 MB body and beefweb hangs
// up over 1 MiB.
export interface AddFromLibraryBody {
	items?: { path: string; subsong: number }[];
	query?: string;
	index?: number;
	replace?: boolean;
	play?: boolean;
}

// ---- the update stream -----------------------------------------------------

// Change-driven, not a ticker: each message carries only the keys that
// changed, so both of these are optional and a long silence is normal.
export interface UpdateMessage {
	player?: PlayerState;
	playlists?: PlaylistInfo[];
}

// Player state is pushed rather than fetched, so it is stored with the moment
// it arrived. Keeping the two together is what makes the position
// interpolation anchor atomic -- see src/player/position.ts.
export interface PlayerSnapshot {
	player: PlayerState;
	syncedAt: number;
}

// Where the player is, as much of it as the source seam needs: which playlist,
// and which position in it. The full ActiveItem carries a duration and the
// track's own columns, none of which help answer "is this row playing".
export interface PlaybackPosition {
	playlistId: string | null;
	index: number;
}

// What identifies a track, as opposed to what is displayed about it. The
// source seam matches on this and nothing else, which is why it is separate
// from the track below: asking it for a full NowPlayingTrack would mean
// inventing an artist and a title to ask a question about a path.
export interface TrackIdentity {
	path: string | null;
	subsong: number;
}

// What `readTrack` resolves the active item's positional columns into.
export interface NowPlayingTrack extends TrackIdentity {
	artist: string;
	title: string;
}
