import type {
	ActiveItem,
	LibraryInfo,
	Permissions,
	PlaybackState,
	PlaylistInfo,
	Volume,
} from "../../src/shared/api/types.ts";
import { type FooJeanOptions, fooJeanState } from "./fooJean.ts";
import {
	changedColumn,
	type Dictionary,
	dictionary,
	encodeJlib,
	wholeColumn,
} from "./jlib.ts";
import capturedLibrary from "./library.json" with { type: "json" };
import capturedPlayer from "./player.json" with { type: "json" };

export type Track = Record<string, string>;

// Where the stream last changed what a given stream time means, in wall-clock
// milliseconds.
export interface StreamMark {
	atMs: number;
	path: string;
	subsong: number;
	position: number;
}

const STREAM_MARKS = 6;

export interface FakePlaylist {
	id: string;
	// foobar2000's own GUID, stable for the playlist's life: what every `foo_jean` route
	// addresses it by, distinct from `id`, which is beefweb's own and stays for the routes
	// still addressed that way.
	guid: string;
	title: string;
	isCurrent: boolean;
	items: Track[];
	isAuto?: boolean;
	structure: number;
	// Bumped alongside `structure` for now: the fake does not yet track a row's content
	// changing in place independently of its position. `player-poll.spec.ts` is where that
	// distinction is tested and owns closing the gap.
	revision: number;
}

export interface LibraryEntry {
	track: Track;
	path: string;
	subsong: number;
}

// One entry in foobar2000's own play queue, which every client shares. The
// handle is the entry; the playlist row it was queued from is where it has one,
// and a track queued by handle never has one.
export interface QueuedEntry {
	playlistId: string | null;
	track: Track;
}

interface CapturedAlbum {
	slug: string;
	artwork?: string;
	tracks: Track[];
}

interface Changed {
	player?: boolean;
	playlists?: boolean;
	playQueue?: boolean;
}

export interface FakePlayerOption {
	id: string;
	name?: string;
	type: "enum" | "bool";
	value: number | boolean;
	enumNames?: string[];
}

export interface FakePlayerState {
	activeItem: ActiveItem;
	info: {
		name: string;
		title?: string;
		version: string;
		pluginVersion: string;
	};
	options?: FakePlayerOption[];
	permissions: Permissions;
	playbackMode: number;
	playbackState: PlaybackState;
	volume: Volume;
}

export interface RecordedRequest {
	method: string;
	path: string;
	// Loose on purpose: a spec reads whichever field the request it asserts on
	// carries.
	// biome-ignore lint/suspicious/noExplicitAny: see above
	body: Record<string, any> | null;
	// How the fake answered, filled in by the routes where the method and the
	// path cannot say: a cover sent again and a cover revalidated are one GET at
	// one address, and only the answer tells them apart.
	answered?: { conditional: boolean; status: number; bytes: number };
}

const LIBRARY = capturedLibrary as { albums: CapturedAlbum[] };
const CAPTURED_PLAYER = capturedPlayer as unknown as FakePlayerState;

const IDLE_ITEM = {
	columns: [],
	duration: -1,
	index: -1,
	playlistId: "",
	playlistIndex: -1,
	position: -1,
};

// What a manual skip pushes while the player opens the next file. See the
// manual-skip trap in ../../src/shared/api/README.md.
const GAP_ITEM = {
	columns: [],
	duration: 0,
	index: -1,
	playlistId: "",
	playlistIndex: -1,
	position: 0,
};

const tracksOf = (album: string) =>
	LIBRARY.albums.find((entry) => entry.slug === album)?.tracks ?? [];
const allTracks = () => LIBRARY.albums.flatMap((album) => album.tracks);

export function generateTracks(count: number): Track[] {
	const source = allTracks();
	const tracks: Track[] = new Array(count);
	for (let index = 0; index < count; index += 1) {
		const template = source[index % source.length];
		tracks[index] = {
			...template,
			"%title%": `${template["%title%"]} (${index + 1})`,
			"%tracknumber%": String((index % 99) + 1).padStart(2, "0"),
			"%path%": `${template["%path%"]}#${index}`,
		};
	}
	return tracks;
}

export function libraryOfShape({
	tracks = 12,
	albums = 1,
	artists = 1,
	genres = 1,
	seconds = 240,
	years = [2000, 2000],
	omit = [],
	// The same artist written two ways, differing in case and in spacing, as
	// collections look once more than one tool has touched them.
	mixedCase = false,
	// A cue sheet or a disc image: this many tracks inside one file, sharing a
	// `%path%` and told apart by `%subsong%` alone. foobar2000 numbers them from 1.
	subsongsPerFile = 1,
}: {
	tracks?: number;
	albums?: number;
	artists?: number;
	genres?: number;
	seconds?: number;
	years?: [number, number];
	omit?: string[];
	mixedCase?: boolean;
	subsongsPerFile?: number;
} = {}): Track[] {
	const template = allTracks()[0];
	const [first, last] = years;
	const built: Track[] = new Array(tracks);

	for (let index = 0; index < tracks; index += 1) {
		const album = index % albums;
		const artist = album % artists;
		const year =
			albums > 1
				? first + Math.round((album * (last - first)) / (albums - 1))
				: first;

		const named = `Artist ${artist + 1}`;
		const spelling =
			mixedCase && index % 2 === 1
				? named.toUpperCase().replace(" ", "  ")
				: named;

		const track: Track = {
			...template,
			"%title%": `Track ${index + 1}`,
			"%tracknumber%": String((index % 99) + 1).padStart(2, "0"),
			"%album%": `Album ${album + 1}`,
			"%artist%": spelling,
			"%album artist%": spelling,
			"%genre%": `Genre ${(index % genres) + 1}`,
			"%year%": String(year),
			"%length_seconds%": String(seconds),
			"%path%": `C:\\Music\\S\\Artist ${artist + 1}\\Album ${album + 1}\\${Math.floor(index / subsongsPerFile) + 1}.mp3`,
		};

		if (subsongsPerFile > 1)
			track["%subsong%"] = String((index % subsongsPerFile) + 1);

		for (const field of omit) delete track[field];
		built[index] = track;
	}

	return built;
}

const libraryRoot = (tracks: Track[]) => {
	const paths = tracks.map((track) =>
		(track["%path%"] ?? "").split("\\").slice(0, -1),
	);
	if (paths.length === 0) return [];
	return paths.reduce((common, parts) => {
		let at = 0;
		while (at < common.length && at < parts.length && common[at] === parts[at])
			at += 1;
		return common.slice(0, at);
	});
};

const libraryPathOf = (track: Track, rootDepth: number) =>
	(track["%path%"] ?? "").split("\\").slice(rootDepth).join("/");

export function libraryItemsOf(tracks: Track[]): LibraryEntry[] {
	const rootDepth = libraryRoot(tracks).length;
	return tracks.map((track) => ({
		track,
		path: libraryPathOf(track, rootDepth),
		subsong: Number(track["%subsong%"]) || 0,
	}));
}

// Fixed rather than derived from position, matching foobar2000's own GUID: stable across a
// rename, a reorder or a restart, and never reused for another playlist. Exported for the demo
// library, which seeds the same fixed set of playlists from its own captured tracks.
export const guidOfDefault = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const FIRST_CREATED_GUID = 1000;

const DEFAULT_PLAYLISTS = (): FakePlaylist[] => [
	{
		id: "p1",
		guid: guidOfDefault(1),
		title: "Default Playlist",
		isCurrent: false,
		structure: 0,
		revision: 0,
		items: tracksOf("jar-of-flies").slice(0, 4),
	},
	{
		id: "p7",
		guid: guidOfDefault(7),
		title: "Library",
		isCurrent: true,
		structure: 0,
		revision: 0,
		items: allTracks(),
	},
	{
		id: "p2",
		guid: guidOfDefault(2),
		title: "Favorites",
		isCurrent: false,
		structure: 0,
		revision: 0,
		items: [
			...tracksOf("deja-entendu").slice(0, 3),
			...tracksOf("jessico").slice(0, 2),
			...tracksOf("deathconsciousness").slice(0, 2),
		],
	},
	{
		id: "p5",
		guid: guidOfDefault(5),
		title: "Rock en Español",
		isCurrent: false,
		structure: 0,
		revision: 0,
		items: tracksOf("jessico"),
	},
	{
		id: "p8",
		guid: guidOfDefault(8),
		title: "#Jean Library",
		isCurrent: false,
		structure: 0,
		revision: 0,
		items: allTracks(),
	},
	{
		id: "p9",
		guid: guidOfDefault(9),
		title: "Recently Added",
		isCurrent: false,
		isAuto: true,
		structure: 0,
		revision: 0,
		items: tracksOf("jar-of-flies").slice(0, 5),
	},
];

export const evaluate = (track: Track, expression: string) =>
	track[expression] ?? "?";

const columnsFor = (track: Track, expressions: string[]) =>
	expressions.map((expression) => evaluate(track, expression));

const pathKey = (value: unknown) => String(value).replace(/\\/g, "/");

const trackKey = (track: Track) =>
	`${track["%path%"]}\u0000${Number(track["%subsong%"]) || 0}`;

// foobar2000 orders paths with Windows' `StrCmpLogicalW`: a run of digits compares as a number, case
// does not count, and an accent folds to its base letter. The fake being self-consistent is not
// enough -- it has to agree with the player about which track sits at which position, or an ordinal
// read here addresses a different track there.
const likeThePlayer = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base",
});

export const compareText = (a: unknown, b: unknown) =>
	likeThePlayer.compare(String(a), String(b));

const byLibraryPath = (a: LibraryEntry, b: LibraryEntry) =>
	compareText(pathKey(a.path), pathKey(b.path)) || a.subsong - b.subsong;

const browseOrder = (a: Track, b: Track) =>
	compareText(evaluate(a, "%album artist%"), evaluate(b, "%album artist%")) ||
	compareText(evaluate(a, "%album%"), evaluate(b, "%album%")) ||
	compareText(evaluate(a, "%tracknumber%"), evaluate(b, "%tracknumber%"));

export function createState({
	playlists = DEFAULT_PLAYLISTS(),
	player,
	librarySize,
	mediaLibrarySize,
	mediaLibrary,
	withoutFields = [],
	library = {},
	retagged = {},
	fooJean = null,
	artworkOf = null,
	countsPlays = false,
}: {
	playlists?: FakePlaylist[];
	// Null as well as absent, because the Playwright fixtures default every
	// option to null rather than leaving it out.
	player?: Partial<FakePlayerState> | null;
	librarySize?: number | null;
	mediaLibrarySize?: number | null;
	mediaLibrary?: Track[] | null;
	withoutFields?: string[];
	library?: Partial<LibraryInfo>;
	retagged?: Record<string, Track>;
	fooJean?: FooJeanOptions | null;
	artworkOf?: ((track: Track) => string | null) | null;
	countsPlays?: boolean | null;
} = {}) {
	const patches = new Map(Object.entries(retagged));
	// Applied to the media library as well as to the playlists below: a fixture
	// that reached only one of them leaves the two describing different libraries.
	const retag = (track: Track): Track => {
		const patch = patches.get(track["%title%"]);
		return patch ? { ...track, ...patch } : track;
	};

	if (patches.size > 0)
		for (const playlist of playlists)
			playlist.items = playlist.items.map(retag);

	// The library API serves its own copy of the tracks, so a player without the
	// component that publishes these fields has to strip both.
	const strip = (track: Track): Track => {
		if (withoutFields.length === 0) return track;
		const kept = { ...track };
		for (const expression of withoutFields) delete kept[expression];
		return kept;
	};

	if (withoutFields.length > 0) {
		for (const playlist of playlists)
			playlist.items = playlist.items.map(strip);
	}

	const generatedForLibrarySize = librarySize
		? generateTracks(librarySize)
		: null;

	const libraryTracks = (
		mediaLibrary
			? mediaLibrary
			: mediaLibrarySize
				? generateTracks(mediaLibrarySize)
				: generatedForLibrarySize
					? generatedForLibrarySize
					: withoutFields.length > 0
						? allTracks().map(strip)
						: allTracks()
	).map(retag);

	const libraryPathByTrackKey = new Map(
		libraryItemsOf(libraryTracks).map((entry) => [
			trackKey(entry.track),
			entry.path,
		]),
	);

	if (generatedForLibrarySize) {
		const library = playlists.find((entry) => entry.title === "Library");
		if (library) library.items = generatedForLibrarySize;
	}

	const listeners = new Set<(message: Changed) => void>();

	const state = {
		playlists,
		player: {
			...structuredClone(CAPTURED_PLAYER),
			playbackState: "stopped",
			activeItem: { ...IDLE_ITEM },
			...player,
		},
		playQueue: [] as QueuedEntry[],
		library: { supported: true, enabled: true, ...library },
		latency: 0,
		skipGapMs: 0,
		requests: [] as RecordedRequest[],
		updateStreams: new Set<() => void>(),
		// Same bound as the component's; `fooJean.ts` puts these on the stream clock.
		streamMarks: [] as StreamMark[],
		libraryFeed: {
			structure: 0,
			revision: 0,
			columns: [] as string[],
			building: null as string[] | null,
			structureFrom: 0,
			dictionaries: new Map<string, Dictionary>(),
			history: [] as {
				revision: number;
				changed: Map<string, number[]>;
				sizes: Map<string, number>;
			}[],
		},
	};

	let playerVersion = 0;
	let playlistsRevision = 0;
	let nextCreatedGuid = FIRST_CREATED_GUID;

	// Bumped for every event `GET /state`'s `playlistsRevision` moves on: a playlist created,
	// removed, moved, retitled, or with its own structure or revision moved. Folded into
	// `playerVersion` too, so the state poll's own validator moves with it -- see `stateTagOf`.
	const markPlaylistsChanged = () => {
		playlistsRevision += 1;
		playerVersion += 1;
	};

	const notify = (changed: Changed) => {
		const message: Changed = {};
		if (changed.player) {
			message.player = true;
			playerVersion += 1;
		}
		if (changed.playlists) {
			message.playlists = true;
			markPlaylistsChanged();
		}
		if (changed.playQueue) message.playQueue = true;
		for (const listener of listeners) listener(message);
	};

	const byId = (id: string) =>
		state.playlists.find((entry) => entry.id === id) ?? null;

	const byGuid = (guid: string) =>
		state.playlists.find((entry) => entry.guid === guid) ?? null;

	// Where each queued entry sits now, read through its handle: `-1` for a track
	// queued by handle and for a row the player has lost the position of.
	const queuedEntries = () =>
		state.playQueue.map((entry) => ({
			playlistId: entry.playlistId,
			track: entry.track,
			index: entry.playlistId
				? (byId(entry.playlistId)?.items.indexOf(entry.track) ?? -1)
				: -1,
		}));

	let queueRevision = 0;
	let publishedQueue: ReturnType<typeof queuedEntries> = [];

	// `PlayerStateStore::queueChanged` compares the whole queue and returns early
	// when it matches, so the revision moves for the contents, the order and a
	// position that shifted or was lost, and for nothing else. It bumps the
	// player's own version alongside it, which is what carries a queue change
	// into `GET /api/state`'s validator.
	const syncQueueRevision = () => {
		const now = queuedEntries();
		const same =
			now.length === publishedQueue.length &&
			now.every(
				(entry, at) =>
					entry.track === publishedQueue[at].track &&
					entry.playlistId === publishedQueue[at].playlistId &&
					entry.index === publishedQueue[at].index,
			);
		if (same) return;
		publishedQueue = now;
		queueRevision += 1;
		playerVersion += 1;
	};

	const coverOfTrack = (track: Track) => {
		const album = LIBRARY.albums.find((entry) =>
			entry.tracks.some((candidate) => candidate["%path%"] === track["%path%"]),
		);
		return album?.artwork ?? artworkOf?.(track) ?? null;
	};

	const coverOf = (playlistId: string, index: number) => {
		const track = index < 0 ? null : byId(playlistId)?.items[index];
		return track ? coverOfTrack(track) : null;
	};

	const consume = (playlist: FakePlaylist, index: number) => {
		const at = state.playQueue.findIndex(
			(entry) =>
				entry.playlistId === playlist.id &&
				entry.track === playlist.items[index],
		);
		if (at < 0) return false;
		state.playQueue.splice(at, 1);
		return true;
	};

	const mark = (track: Track, position: number) => {
		state.streamMarks = [
			...state.streamMarks.slice(1 - STREAM_MARKS),
			{
				atMs: Date.now(),
				path: String(evaluate(track, "%path%") ?? ""),
				subsong: 0,
				position,
			},
		];
	};

	// What the component's own store holds, which is not beefweb's `activeItem`:
	// the playing file, where it sits and how long it is. `PlayerStateStore` in
	// `plugins/fb2k/src/core/player_state.cpp` clears it on a stop and on
	// nothing else.
	let playing: {
		track: Track;
		playlistId: string;
		index: number;
		duration: number;
	} | null = null;
	let announced: Track | null = null;
	// beefweb empties `activeItem` while the player opens the next file and the
	// component leaves its own state standing: `on_playback_stop` in
	// `plugins/fb2k/src/fb2k/playback_watch.cpp` returns early for the outgoing
	// track of a change. See GAP_ITEM.
	let gap = false;

	const named = (track: Track | null) =>
		track && announced ? { ...track, ...announced } : track;

	// beefweb's answer for the playing track, empty across a manual skip.
	const activeTrack = () => {
		if (gap) return null;
		const item = state.player.activeItem;
		return playing?.track ?? byId(item.playlistId)?.items[item.index] ?? null;
	};

	// The component's, held across one.
	const playingTrack = () => named(playing?.track ?? null);

	// An edit to the playlist the player is playing from moves the playing row
	// under it, and no playback callback fires:
	// `plugins/fb2k/src/fb2k/playback_watch.cpp`'s LocationCallback republishes
	// the row the item landed on, and an edit to any other playlist returns
	// before it touches the store. Where the item is gone from the playlist
	// altogether the row is `-1`, which is that callback's absent location, and
	// the track carries on playing with nowhere to point at.
	const editItems = (playlist: FakePlaylist, edit: () => void) => {
		const item = state.player.activeItem;
		const held = playing?.playlistId === playlist.id ? playing : null;
		edit();
		playlist.structure += 1;
		playlist.revision += 1;
		markPlaylistsChanged();
		if (!held) return;
		const at = playlist.items.indexOf(held.track);
		// An unmoved row publishes nothing and the next poll is a 304, which is
		// what `applyLocked` in `plugins/fb2k/src/core/player_state.cpp` gives the
		// component by returning early on an unchanged value.
		if (at === held.index) return;
		held.index = at;
		if (item.playlistId === playlist.id) item.index = at;
		notify({ player: true });
	};

	// What `GET /api/state`'s `player.position` reports: the position as of the
	// last time it was set, and when that was. Distinct from `streamMarks`
	// above, which is the audio stream's own clock. Re-taken on a track change,
	// a pause, a resume, a stop or a seek, and never on a volume-only write,
	// which would otherwise erase time a client has already counted since the
	// last mark.
	let positionMark: { seconds: number; takenAtMs: number } = {
		seconds: Math.max(state.player.activeItem.position, 0),
		takenAtMs: Date.now(),
	};

	const markPosition = (seconds: number) => {
		positionMark = { seconds, takenAtMs: Date.now() };
	};

	const setActive = (
		playlist: FakePlaylist,
		index: number,
		playbackState: PlaybackState,
	) => {
		const track = playlist.items[index];
		if (!track) return;

		const leaving = activeTrack();
		if (leaving && leaving !== track) countPlay(leaving);

		mark(track, 0);
		const dequeued = consume(playlist, index);
		const duration = Number(evaluate(track, "%length_seconds%")) || 0;
		playing = { track, playlistId: playlist.id, index, duration };
		announced = null;
		state.player.activeItem = {
			columns: [],
			duration,
			index,
			playlistId: playlist.id,
			playlistIndex: state.playlists.indexOf(playlist),
			position: 0,
		};
		state.player.playbackState = playbackState;
		markPosition(0);
		// Playing from a playlist makes it the current one, as the player does.
		for (const entry of state.playlists) entry.isCurrent = entry === playlist;
		notify({ player: true, playlists: true, playQueue: dequeued });
	};

	// beefweb's gap alone: see the comment on `gap` above, and GAP_ITEM.
	const withSkipGap = (play: () => void) => {
		if (state.skipGapMs <= 0) return play();
		gap = true;
		state.player.activeItem = { ...GAP_ITEM };
		notify({ player: true });
		setTimeout(() => {
			gap = false;
			play();
		}, state.skipGapMs);
	};

	const step = (delta: number) => {
		// The queue outranks both playback order and the playlist.
		const queued = delta > 0 ? state.playQueue[0] : null;
		if (queued) {
			const from = queued.playlistId ? byId(queued.playlistId) : null;
			const at = from?.items.indexOf(queued.track) ?? -1;
			if (from && at >= 0) {
				withSkipGap(() => setActive(from, at, "playing"));
				return;
			}
			// A queued track whose row has gone: the player skips it.
			state.playQueue.shift();
			notify({ playQueue: true });
		}

		const item = state.player.activeItem;
		const playlist = byId(item.playlistId);
		if (!playlist || item.index < 0) return;
		const next = item.index + delta;
		if (next < 0 || next >= playlist.items.length) return;
		withSkipGap(() => setActive(playlist, next, "playing"));
	};

	const feed = state.libraryFeed;

	const RETAINED_REVISIONS = 32;

	const PLAY_COUNT = "%lastfm_play_count%";

	const ordinalOrder = () => libraryItemsOf(libraryTracks).sort(byLibraryPath);

	const dictionaryFor = (name: string) => {
		const held = feed.dictionaries.get(name);
		if (held) return held;
		const made = dictionary();
		feed.dictionaries.set(name, made);
		return made;
	};

	const remember = (changed: Map<string, number[]>) => {
		feed.history.push({
			revision: feed.revision,
			changed,
			sizes: new Map(
				[...feed.dictionaries].map(([name, dict]) => [
					name,
					dict.values.length,
				]),
			),
		});
		if (feed.history.length > RETAINED_REVISIONS) feed.history.shift();
	};

	const buildLibrary = () => {
		const items = ordinalOrder();
		const cut = (path: string) => path.lastIndexOf("/") + 1;
		const bone = (name: string, values: string[]) =>
			wholeColumn(null, dictionaryFor(name), values);

		return {
			items,
			columns: feed.columns.map((expression) =>
				wholeColumn(
					expression,
					dictionaryFor(expression),
					items.map((entry) => String(evaluate(entry.track, expression))),
				),
			),
			spine: {
				directory: bone(
					"directory",
					items.map((entry) => entry.path.slice(0, cut(entry.path))),
				),
				filename: bone(
					"filename",
					items.map((entry) => entry.path.slice(cut(entry.path))),
				),
				subsong: bone(
					"subsong",
					items.map((entry) => String(entry.subsong)),
				),
			},
		};
	};

	function finishLibraryBuild() {
		if (!feed.building) return;
		feed.columns = feed.building;
		feed.building = null;
		feed.structure += 1;
		feed.revision += 1;
		feed.structureFrom = feed.revision;
		feed.dictionaries.clear();
		feed.history.length = 0;
		buildLibrary();
		remember(new Map());
	}

	function countPlay(track: Track) {
		if (!countsPlays || !feed.columns.includes(PLAY_COUNT)) return;

		const items = ordinalOrder();
		const ordinal = items.findIndex(
			(entry) => entry.track["%path%"] === track["%path%"],
		);
		if (ordinal < 0) return;

		const row = items[ordinal].track;
		row[PLAY_COUNT] = String(Number(row[PLAY_COUNT] ?? 0) + 1);
		dictionaryFor(PLAY_COUNT).id(row[PLAY_COUNT] as string);

		feed.revision += 1;
		remember(new Map([[PLAY_COUNT, [ordinal]]]));
	}

	function libraryChanges(since: number) {
		if (since < feed.structureFrom) return { status: 409 as const };

		const at = feed.history.findIndex((entry) => entry.revision === since);
		if (at < 0) return { status: 410 as const };

		const moved = new Map<string, Set<number>>();
		for (const entry of feed.history.slice(at + 1))
			for (const [name, ordinals] of entry.changed) {
				const held = moved.get(name) ?? new Set<number>();
				moved.set(name, held);
				for (const ordinal of ordinals) held.add(ordinal);
			}

		const items = ordinalOrder();
		const sizes = feed.history[at].sizes;

		return {
			status: 200 as const,
			bytes: encodeJlib({
				kind: "delta",
				structure: feed.structure,
				revision: feed.revision,
				since,
				trackCount: items.length,
				columns: [...moved].map(([name, ordinals]) =>
					changedColumn(
						name,
						dictionaryFor(name),
						sizes.get(name) ?? 0,
						[...ordinals]
							.sort((a, b) => a - b)
							.map((ordinal) => ({
								ordinal,
								value: String(evaluate(items[ordinal].track, name)),
							})),
					),
				),
				spine: {},
			}),
		};
	}

	// beefweb addresses a queue entry as a playlist and a position, so an entry
	// queued by handle is one it has no way to name: `-1`, the same answer it
	// gives for a row that has gone.
	const queuePayload = (expressions: string[] = []) =>
		state.playQueue.map((entry) => {
			const playlist = entry.playlistId ? byId(entry.playlistId) : null;
			return {
				playlistId: entry.playlistId ?? "",
				playlistIndex: playlist ? state.playlists.indexOf(playlist) : -1,
				itemIndex: playlist ? playlist.items.indexOf(entry.track) : -1,
				columns: columnsFor(entry.track, expressions),
			};
		});

	return {
		player: state.player,
		latency: state.latency,
		get skipGapMs() {
			return state.skipGapMs;
		},
		set skipGapMs(ms: number) {
			state.skipGapMs = ms;
		},
		get playQueue() {
			return queuePayload();
		},
		requests: state.requests,
		updateStreams: state.updateStreams,
		get streamMarks() {
			return state.streamMarks;
		},
		get positionMark() {
			return positionMark;
		},
		get playerVersion() {
			syncQueueRevision();
			return playerVersion;
		},
		get queueRevision() {
			syncQueueRevision();
			return queueRevision;
		},
		get playlistsRevision() {
			return playlistsRevision;
		},
		queuedEntries,
		library: state.library,
		// beefweb's only answer for what the playing track is called: the `trcolumns`
		// a subscriber asked for, evaluated against the active item. A spec sets this
		// false to take the name away from beefweb with the subscription otherwise
		// live, which is the state Jean is heading for.
		answersTrackColumns: true,
		fooJean: fooJeanState(fooJean),
		// Which `?format=` each stream was opened with, in order; `requests` records
		// paths without their query.
		streamFormats: [] as string[],
		openStreams: 0,
		peakStreams: 0,
		// Somebody asked to hear the player alongside the listeners, either by
		// raising its fader, which is what `patchPlayer` watches for, or through
		// `DELETE /api/stream/hold`. Cleared when the last listener leaves.
		holdReleased: false,
		// Devices this fake is streaming to, keyed by the id they named themselves
		// with. Grouped, because one device routinely holds more than one socket.
		streamDevices: new Map<
			string,
			{
				deviceId: string;
				name: string | null;
				format: string;
				connections: number;
				listeningFor: number;
			}
		>(),
		libraryTracks,
		libraryFeed: state.libraryFeed,
		ordinalOrder,
		get playlists() {
			return state.playlists;
		},

		announceHold() {
			notify({ player: true });
		},

		playingTrack,
		editItems,

		// What the component holds a handle on, for the routes that answer from
		// it rather than from beefweb's `activeItem`.
		get playingItem() {
			return playing;
		},

		// A tag written at the player, which the playing track sees: a
		// `metadb_handle` resolves through foobar2000's metadb, so the playlist
		// row and the handle the component holds are one record. The row's object
		// is replaced rather than written through, since every state the fake
		// builds comes off one set of captured tracks and a write in place would
		// outlive the test that made it.
		retagPlaying(fields: Track) {
			if (!playing) return null;
			const retagged = { ...playing.track, ...fields };
			const playlist = byId(playing.playlistId);
			const at = playlist?.items.indexOf(playing.track) ?? -1;
			if (playlist && at >= 0) playlist.items[at] = retagged;
			playing = { ...playing, track: retagged };
			return retagged;
		},

		// An internet radio station announcing the song it is playing now: the
		// name moves and the track does not, which is what
		// `flag_on_playback_dynamic_info_track` in
		// `plugins/fb2k/src/fb2k/playback_watch.cpp` follows. A field left out here
		// still reads off the playlist entry, and an empty one crosses
		// `GET /api/state` as `null`. One announcement settles both fields and
		// nothing survives from the one before: that callback reads the handle back
		// and runs both title-format scripts fresh, so the component holds no
		// memory of a field at all.
		announceSong({ title, artist }: { title?: string; artist?: string }) {
			announced = {
				...(title === undefined ? null : { "%title%": title }),
				...(artist === undefined ? null : { "%artist%": artist }),
			};
			notify({ player: true });
		},

		subscribe(listener: (message: Changed) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		record(method: string, path: string, body: RecordedRequest["body"]) {
			const entry: RecordedRequest = { method, path, body };
			state.requests.push(entry);
			return entry;
		},

		playlistById: byId,
		playlistByGuid: byGuid,

		playlistsPayload: () =>
			state.playlists.map((entry, index) => ({
				id: entry.id,
				index,
				isCurrent: entry.isCurrent,
				itemCount: entry.items.length,
				title: entry.title,
				totalTime: 0,
			})),

		// Derived rather than set, so a fixture that starts with somebody already
		// listening starts muted, exactly as reconnecting to a running install would.
		get playerHeld(): boolean {
			if (!this.fooJean.canMuteWhileStreaming || this.holdReleased)
				return false;
			return this.streamDevices.size + this.fooJean.otherListeners.length > 0;
		},

		playerPayload(trcolumns: string[] = []) {
			const item = state.player.activeItem;
			const track = named(activeTrack());
			return {
				...state.player,
				volume: this.playerHeld
					? { ...state.player.volume, isMuted: true, value: -100 }
					: state.player.volume,
				activeItem: {
					...item,
					columns:
						track && this.answersTrackColumns
							? columnsFor(track, trcolumns)
							: [],
				},
			};
		},

		itemsPayload(
			playlistId: string,
			offset: number,
			count: number,
			expressions: string[],
		) {
			const playlist = byId(playlistId);
			if (!playlist) return null;
			const slice = playlist.items.slice(offset, offset + count);
			return {
				playlistItems: {
					offset,
					totalCount: playlist.items.length,
					items: slice.map((track) => ({
						columns: columnsFor(track, expressions),
					})),
				},
			};
		},

		artworkFor: coverOf,

		// Resolved through the playing item rather than through the media library:
		// foobar2000's own now-playing loader reads the file, so a track the
		// library has never seen has a cover too. Two tracks of one album answer
		// with one picture, which is what gives them one validator.
		playingArtwork() {
			const track = playingTrack();
			return track ? coverOfTrack(track) : null;
		},

		playItem(playlistId: string, index: number) {
			const playlist = byId(playlistId);
			if (playlist) setActive(playlist, index, "playing");
		},

		playPause() {
			const { playbackState, activeItem } = state.player;
			if (playbackState === "stopped") {
				// Stopped-then-play resumes the current playlist from the top, which is
				// what foobar does with no active item.
				const playlist =
					state.playlists.find((entry) => entry.isCurrent) ??
					state.playlists[0];
				if (playlist?.items.length)
					setActive(playlist, Math.max(activeItem.index, 0), "playing");
				return;
			}
			state.player.playbackState =
				playbackState === "playing" ? "paused" : "playing";
			markPosition(activeItem.position);
			notify({ player: true });
		},

		stop() {
			state.player.playbackState = "stopped";
			playing = null;
			announced = null;
			state.player.activeItem = { ...IDLE_ITEM };
			markPosition(0);
			notify({ player: true });
		},

		next: () => step(1),
		previous: () => step(-1),

		patchPlayer(
			body: {
				position?: number;
				relativePosition?: number;
				volume?: number;
				isMuted?: boolean;
				playbackState?: PlaybackState;
				options?: { id: string; value: number | boolean }[];
			} = {},
		) {
			const item = state.player.activeItem;
			const before = item.position;
			if (body.position != null) item.position = body.position;
			if (body.relativePosition != null) {
				item.position = Math.min(
					Math.max(item.position + body.relativePosition, 0),
					item.duration,
				);
			}
			const repositioned = item.position !== before;
			if (repositioned) {
				const track = byId(item.playlistId)?.items[item.index];
				if (track) mark(track, item.position);
			}
			if (body.volume != null) {
				state.player.volume.value = body.volume;
				if (body.volume > state.player.volume.min && this.playerHeld)
					this.holdReleased = true;
			}
			if (body.isMuted != null) state.player.volume.isMuted = body.isMuted;
			if (body.playbackState) state.player.playbackState = body.playbackState;
			for (const option of body.options ?? []) {
				const target = state.player.options?.find(
					(entry) => entry.id === option.id,
				);
				if (target) target.value = option.value;
				if (option.id === "playbackOrder")
					state.player.playbackMode = option.value as number;
			}
			if (repositioned || body.playbackState) markPosition(item.position);
			notify({ player: true });
		},

		nudgeVolume(delta: number) {
			const { volume } = state.player;
			volume.value = Math.min(
				Math.max(volume.value + delta, volume.min),
				volume.max,
			);
			notify({ player: true });
		},

		// What `%genre% IS "x"` would match, which is the only query Jean composes. Read
		// off the media library rather than a playlist, as an autoplaylist is.
		previewMatches(query: string): number {
			const wanted = /^%genre% IS "(.*)"$/
				.exec(query)?.[1]
				?.replace(/""/g, '"');
			if (wanted === undefined) return 0;
			const key = wanted.trim().toLowerCase();
			return allTracks().filter(
				(track) => (track["%genre%"] ?? "").trim().toLowerCase() === key,
			).length;
		},

		addPlaylist(title: string): PlaylistInfo {
			const used = state.playlists.map((entry) => Number(entry.id.slice(1)));
			const id = `p${Math.max(0, ...used) + 1}`;
			const playlist: FakePlaylist = {
				id,
				guid: guidOfDefault(nextCreatedGuid++),
				title: title || "New playlist",
				isCurrent: false,
				structure: 0,
				revision: 0,
				items: [],
			};
			state.playlists.push(playlist);
			notify({ playlists: true });
			return {
				id,
				index: state.playlists.length - 1,
				isCurrent: false,
				itemCount: 0,
				title: playlist.title,
				totalTime: 0,
			};
		},

		renamePlaylist(id: string, title: string) {
			const playlist = byId(id);
			if (!playlist) return false;
			playlist.title = title;
			notify({ playlists: true });
			return true;
		},

		removePlaylist(id: string) {
			const at = state.playlists.findIndex((entry) => entry.id === id);
			if (at < 0) return false;
			state.playlists.splice(at, 1);
			notify({ playlists: true });
			return true;
		},

		movePlaylist(id: string, index: number) {
			const from = state.playlists.findIndex((entry) => entry.id === id);
			if (from < 0) return false;
			const [moved] = state.playlists.splice(from, 1);
			state.playlists.splice(
				index < 0 ? state.playlists.length : index,
				0,
				moved,
			);
			notify({ playlists: true });
			return true;
		},

		// Item changes push `player` and not `playlists`, as beefweb does: an add, a
		// rename or a delete produces a `playlists` message; a copy or a remove of
		// items does not. So `itemCount` in PlaylistInfo goes stale from the first
		// write on.
		copyItems(sourceId: string, targetId: string, indices: number[]) {
			const source = byId(sourceId);
			const target = byId(targetId);
			if (!source || !target) return false;
			if (target.isAuto) return true;
			// Appended without a duplicate check and in the source's order rather than the
			// caller's, because that is what the player does. `add-from-library` too, so it
			// is a property of the player rather than of one endpoint.
			const ordered = [...indices].sort((a, b) => a - b);
			editItems(target, () => {
				target.items.push(
					...ordered.map((index) => source.items[index]).filter(Boolean),
				);
			});
			notify({ player: true });
			return true;
		},

		removeItems(playlistId: string, indices: number[]) {
			const playlist = byId(playlistId);
			if (!playlist) return false;
			const drop = new Set(indices);
			editItems(playlist, () => {
				playlist.items = playlist.items.filter((_, index) => !drop.has(index));
			});
			notify({ player: true, playQueue: true });
			return true;
		},

		notifyPlaylists() {
			notify({ playlists: true });
		},

		libraryInfo() {
			const { supported, enabled } = state.library;
			return {
				library: {
					supported,
					enabled,
					itemCount:
						supported && enabled ? libraryItemsOf(libraryTracks).length : 0,
				},
			};
		},

		libraryExport(): Uint8Array<ArrayBuffer> {
			const built = buildLibrary();
			return encodeJlib({
				kind: "snapshot",
				structure: state.libraryFeed.structure,
				revision: state.libraryFeed.revision,
				trackCount: built.items.length,
				columns: built.columns,
				spine: built.spine,
			});
		},

		finishLibraryBuild,

		countPlay,

		libraryChanges,

		libraryItemsPayload({
			offset,
			count,
			expressions,
			sort,
			desc,
		}: {
			offset: number;
			count: number | null;
			expressions: string[];
			sort?: string | null;
			desc?: boolean;
		}) {
			const items = libraryItemsOf(libraryTracks);

			if (sort && sort !== "%path%") {
				const key = (entry: LibraryEntry) => evaluate(entry.track, sort);
				items.sort((a, b) => compareText(pathKey(key(a)), pathKey(key(b))));
			} else items.sort(byLibraryPath);
			if (desc) items.reverse();

			const page =
				count === null
					? items.slice(offset)
					: items.slice(offset, offset + count);
			return {
				libraryItems: {
					offset,
					totalCount: items.length,
					items: page.map((entry) => ({
						path: entry.path,
						subsong: entry.subsong,
						columns: columnsFor(entry.track, expressions),
					})),
				},
			};
		},

		libraryNodesPayload({
			path,
			offset,
			count,
			expressions,
		}: {
			path?: string | null;
			offset: number;
			count: number | null;
			expressions: string[];
		}) {
			const prefix = path ? `${path}/` : "";
			const under = libraryItemsOf(libraryTracks).filter((entry) =>
				entry.path.startsWith(prefix),
			);
			if (path && under.length === 0) return null;

			const folders = new Map<string, number>();
			const tracks: { entry: LibraryEntry; name: string }[] = [];

			for (const entry of under) {
				const rest = entry.path.slice(prefix.length);
				const cut = rest.indexOf("/");
				if (cut < 0) {
					tracks.push({ entry, name: rest });
				} else {
					const name = rest.slice(0, cut);
					folders.set(name, (folders.get(name) ?? 0) + 1);
				}
			}

			const byName = (a: { name: string }, b: { name: string }) =>
				a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
			const items = [
				...[...folders]
					.map(([name, itemCount]) => ({
						type: "D",
						name,
						path: `${prefix}${name}`,
						itemCount,
					}))
					.sort(byName),
				...tracks
					.map(({ entry, name }) => ({
						type: "F",
						name,
						path: entry.path,
						subsong: entry.subsong,
						columns: columnsFor(entry.track, expressions),
					}))
					.sort(byName),
			];

			const page =
				count === null
					? items.slice(offset)
					: items.slice(offset, offset + count);
			const payload: {
				offset: number;
				totalCount: number;
				path: string;
				items: unknown[];
				parentPath?: string;
			} = { offset, totalCount: items.length, path: path ?? "", items: page };
			// Absent at the top level, present everywhere else -- the client uses its
			// absence to know it cannot navigate up.
			if (path) payload.parentPath = path.split("/").slice(0, -1).join("/");
			return { libraryNodes: payload };
		},

		addFromLibrary(
			playlistId: string,
			{
				items,
				index,
				replace,
				play,
			}: {
				items?: { path: string; subsong?: number }[];
				index?: number;
				replace?: boolean;
				play?: boolean;
			},
		) {
			const playlist = byId(playlistId);
			if (!playlist) return false;
			if (playlist.isAuto) return true;

			const addressOf = (path: string, subsong = 0) =>
				`${path}\u0000${subsong}`;
			const known = new Map(
				libraryItemsOf(libraryTracks).map((entry) => [
					addressOf(entry.path, entry.subsong),
					entry,
				]),
			);
			const chosen = (
				items ??
				[...known.values()].map((entry) => ({
					path: entry.path,
					subsong: entry.subsong,
				}))
			)
				.map((ref) => known.get(addressOf(ref.path, ref.subsong)))
				.filter((entry) => entry !== undefined)
				.sort((a, b) => browseOrder(a.track, b.track))
				.map((entry) => entry.track);

			const at =
				index !== undefined && Number.isInteger(index)
					? index
					: replace
						? 0
						: playlist.items.length;
			editItems(playlist, () => {
				if (replace) playlist.items = [];
				playlist.items.splice(at, 0, ...chosen);
			});

			notify({ playlists: true });
			if (play && chosen.length > 0) setActive(playlist, at, "playing");
			return true;
		},

		sortItems(
			playlistId: string,
			{ by, desc, random }: { by: string; desc?: boolean; random?: boolean },
		) {
			const playlist = byId(playlistId);
			if (!playlist) return false;

			editItems(playlist, () => {
				if (random) {
					playlist.items = [...playlist.items].sort(() => 0);
					return;
				}
				playlist.items = [...playlist.items].sort((a, b) =>
					compareText(pathKey(evaluate(a, by)), pathKey(evaluate(b, by))),
				);
				if (desc) playlist.items.reverse();
			});

			notify({ playlists: true });
			return true;
		},

		libraryArtworkFor(path: string) {
			const entry = libraryItemsOf(libraryTracks).find(
				(item) => item.path === path,
			);
			if (!entry) return null;
			const album = LIBRARY.albums.find((a) => a.tracks.includes(entry.track));
			if (album) return `${album.slug}.jpg`;
			return artworkOf?.(entry.track) ?? null;
		},

		libraryPathFor(track: Track) {
			return libraryPathByTrackKey.get(trackKey(track)) ?? null;
		},

		queueInsert(entries: QueuedEntry[], at?: number) {
			state.playQueue.splice(at ?? state.playQueue.length, 0, ...entries);
			notify({ playQueue: true });
		},

		queueMove(from: number, to: number) {
			const [entry] = state.playQueue.splice(from, 1);
			state.playQueue.splice(to, 0, entry);
			notify({ playQueue: true });
		},

		queueRemoveAt(index: number) {
			state.playQueue.splice(index, 1);
			notify({ playQueue: true });
		},

		queueAdd(playlistId: string, itemIndex: number) {
			const playlist = byId(playlistId);
			const track = playlist?.items[itemIndex];
			if (!track) return false;
			state.playQueue.push({ playlistId, track });
			notify({ playQueue: true });
			return true;
		},

		queueRemove({
			queueIndex,
			plref,
			itemIndex,
		}: {
			queueIndex?: number;
			plref?: string;
			itemIndex?: number;
		}) {
			const at =
				typeof queueIndex === "number"
					? queueIndex
					: state.playQueue.findIndex(
							(entry) =>
								entry.playlistId === plref &&
								byId(plref)?.items.indexOf(entry.track) === itemIndex,
						);

			if (at < 0 || at >= state.playQueue.length) return false;
			state.playQueue.splice(at, 1);
			notify({ playQueue: true });
			return true;
		},

		queueClear() {
			state.playQueue.length = 0;
			notify({ playQueue: true });
		},

		queuePayload,
	};
}

export { allTracks, DEFAULT_PLAYLISTS, LIBRARY, tracksOf };
