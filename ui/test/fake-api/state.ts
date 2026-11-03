import { GENRE_EXPRESSION, valuesIn } from "../../src/shared/api/multiValue.ts";
import type {
	PlaybackState,
	PlaylistInfo,
	Volume,
} from "../../src/shared/api/types.ts";
import { allTracks, LIBRARY, type Track, tracksOf } from "./capturedLibrary.ts";
import { type FooJeanOptions, fooJeanState } from "./fooJean/options.ts";
import { JEAN_MODE_BY_ORDER } from "./fooJean/playbackModes.ts";
import type { Bucket } from "./fooJean/rateLimits.ts";
import { type Column, encodeJlib, UNRESOLVED, windowOfValues } from "./jlib.ts";
import { generateTracks } from "./libraryShapes.ts";
import capturedPlayer from "./player.json" with { type: "json" };
import { compareKeys, pathKey, textKey } from "./playerOrder.ts";
import { createSessions, type SessionDevice } from "./sessions.ts";
import { evaluate, sortedOrder } from "./titleFormat.ts";
import {
	CHUNK,
	mapped,
	runToEnd,
	runYielding,
	type Sweep,
	sorted,
} from "./yielding.ts";

export type { Track };

const SYNC_SWEEP_LIMIT = 100_000;

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
	// addresses it by. `id` is the fake's own short key, which specs and control
	// routes name a playlist by.
	guid: string;
	title: string;
	isCurrent: boolean;
	items: Track[];
	isAuto?: boolean;
	// `bigint`: `GENERATION_SEED` below has why.
	structure: bigint;
	revision: bigint;
	changeHistory: { revision: bigint; positions: number[] }[];
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

export interface FakeActiveItem {
	duration: number;
	index: number;
	playlistId: string;
	position: number;
}

export interface FakePlayerState {
	activeItem: FakeActiveItem;
	info: { name: string; version: string };
	options?: FakePlayerOption[];
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
	// The bucket that refused it, where a rate limit rather than a knob answered `429`.
	limited?: Bucket;
	// The status of every answer, set as it is written; `answered` is filled only
	// by the routes that need it.
	status?: number;
}

const CAPTURED_PLAYER = capturedPlayer as Omit<FakePlayerState, "activeItem">;

// foobar2000's own playback-order option, every stock order declared.
const playbackOrderOf = (value: number): FakePlayerOption => ({
	id: "playbackOrder",
	name: "Playback order",
	type: "enum",
	value,
	enumNames: Object.keys(JEAN_MODE_BY_ORDER),
});

const IDLE_ITEM: FakeActiveItem = {
	duration: -1,
	index: -1,
	playlistId: "",
	position: -1,
};

const directoryOf = (track: Track) =>
	(track["%path%"] ?? "").split("\\").slice(0, -1);

function* libraryRootSweep(tracks: Track[]): Sweep<string[]> {
	if (tracks.length === 0) return [];
	let common = directoryOf(tracks[0]);
	for (let at = 1; at < tracks.length; at += 1) {
		const parts = directoryOf(tracks[at]);
		let shared = 0;
		while (
			shared < common.length &&
			shared < parts.length &&
			common[shared] === parts[shared]
		)
			shared += 1;
		if (shared < common.length) common = common.slice(0, shared);
		if (at % CHUNK === 0) yield;
	}
	return common;
}

const libraryPathOf = (track: Track, rootDepth: number) =>
	(track["%path%"] ?? "").split("\\").slice(rootDepth).join("/");

const localStampOf = (when: Date) =>
	`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}:${String(when.getSeconds()).padStart(2, "0")}`;

function* libraryItemsSweep(
	tracks: Track[],
	known?: number,
): Sweep<LibraryEntry[]> {
	const rootDepth = known ?? (yield* libraryRootSweep(tracks)).length;
	return yield* mapped(tracks, (track) => ({
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

// Every playlist's structure generation and content revision start here and step by one per edit.
// It is `kThroughADouble` in `plugins/fb2k/tests/playlist_route_test.cpp`, the value every number
// within five hundred of it rounds to as a double. In [2^62, 2^63) a double's ULP is 1024, so a
// thousand consecutive generations collapse to one and a client that parses either counter as a
// number fails on the first edit; a smaller seed would agree with such a client by coincidence,
// since a double stays exact at that scale. A `bigint`, since a `number` this size cannot step by
// one without rounding four consecutive values onto the last.
export const GENERATION_SEED = 9204739866101318656n;

const FIRST_CREATED_GUID = 1000;

const DEFAULT_PLAYLISTS = (): FakePlaylist[] => [
	{
		id: "p1",
		guid: guidOfDefault(1),
		title: "Default Playlist",
		isCurrent: false,
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
		items: tracksOf("jar-of-flies").slice(0, 4),
	},
	{
		id: "p7",
		guid: guidOfDefault(7),
		title: "Library",
		isCurrent: true,
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
		items: allTracks(),
	},
	{
		id: "p2",
		guid: guidOfDefault(2),
		title: "Favorites",
		isCurrent: false,
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
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
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
		items: tracksOf("jessico"),
	},
	{
		id: "p8",
		guid: guidOfDefault(8),
		title: "#Jean Library",
		isCurrent: false,
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
		items: allTracks(),
	},
	{
		id: "p9",
		guid: guidOfDefault(9),
		title: "Recently Added",
		isCurrent: false,
		isAuto: true,
		structure: GENERATION_SEED,
		revision: GENERATION_SEED,
		changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
		items: tracksOf("jar-of-flies").slice(0, 5),
	},
];

export const sameMembers = (held: string[], asked: string[]) =>
	held.length === asked.length && asked.every((one) => held.includes(one));

export const trackKey = (track: Track) =>
	`${track["%path%"]}\u0000${Number(track["%subsong%"]) || 0}`;

export const readsField = (expression: string, field: string) => {
	const name = field.toLowerCase();
	const text = expression.toLowerCase();
	return (
		text.includes(`%${name}%`) ||
		text.includes(`$meta(${name})`) ||
		text.includes(`$meta(${name},`)
	);
};

function* sortedByLibraryPath(entries: LibraryEntry[]): Sweep<LibraryEntry[]> {
	const keyed = yield* mapped(entries, (entry) => ({
		entry,
		key: textKey(pathKey(entry.path)),
	}));
	const ordered = yield* sorted(
		keyed,
		(a, b) => compareKeys(a.key, b.key) || a.entry.subsong - b.entry.subsong,
	);
	return yield* mapped(ordered, ({ entry }) => entry);
}

const QUERY_FIELDS: Record<string, string> = {
	genre: GENRE_EXPRESSION,
	artist: "%artist%",
	"album artist": "%album artist%",
	album: "%album%",
};

const QUERY_TERM = `%?(genre|artist|album artist|album)%? IS "((?:[^"]|"")*)"`;
const QUERY_SHAPE = new RegExp(
	`^(?:ALL|${QUERY_TERM}(?: (?:AND|OR) ${QUERY_TERM})*)$`,
	"i",
);
const SORT_SUFFIX = / SORT (?:DESCENDING )?BY .+$/i;

// The queries the fake can answer: `ALL`, or `<field> IS "<value>"` terms joined by `AND` and
// `OR`, `AND` binding tighter, over the fields in `QUERY_FIELDS`, with a trailing `SORT BY` left
// unread. A value matches whole and without regard to case, against each value of a multi-valued
// tag.
function queryMatcher(query: string): ((track: Track) => boolean) | null {
	const body = query.replace(SORT_SUFFIX, "").trim();
	if (!QUERY_SHAPE.test(body)) return null;
	if (/^ALL$/i.test(body)) return () => true;

	const terms = [...body.matchAll(new RegExp(QUERY_TERM, "gi"))].map(
		([, field, value]) => {
			const expression = QUERY_FIELDS[field.toLowerCase()];
			const key = value.replace(/""/g, '"').trim().toLowerCase();
			return (track: Track) =>
				valuesIn(evaluate(track, expression)).some(
					(held) => held.trim().toLowerCase() === key,
				);
		},
	);
	const joins = body
		.replace(new RegExp(QUERY_TERM, "gi"), "")
		.split(/\s+/)
		.filter(Boolean);

	const alternatives = [[terms[0]]];
	joins.forEach((join, at) => {
		if (join.toUpperCase() === "OR") alternatives.push([terms[at + 1]]);
		else alternatives[alternatives.length - 1].push(terms[at + 1]);
	});
	return (track) =>
		alternatives.some((group) => group.every((term) => term(track)));
}

const STRUCTURES_PER_FAKE = 2 ** 24;
const STRUCTURE_BASE_OF_THIRTEEN_DIGITS = 1_000_000_000_000;
let fakesCreated = 0;

export function createState({
	playlists = DEFAULT_PLAYLISTS(),
	player,
	librarySize,
	mediaLibrarySize,
	mediaLibrary,
	withoutFields = [],
	retagged = {},
	embeddedArt = {},
	playlistsFromRow = {},
	fooJean = { reachable: false },
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
	retagged?: Record<string, Track>;
	embeddedArt?: Record<string, string>;
	playlistsFromRow?: Record<string, number>;
	fooJean?: FooJeanOptions;
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

	for (const [id, from] of Object.entries(playlistsFromRow)) {
		const playlist = playlists.find((entry) => entry.id === id);
		if (playlist) playlist.items = playlist.items.slice(from);
	}

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

	if (generatedForLibrarySize) {
		const library = playlists.find((entry) => entry.title === "Library");
		if (library) library.items = generatedForLibrarySize;
	}

	const listeners = new Set<(message: Changed) => void>();

	const state = {
		playlists,
		player: {
			...structuredClone(CAPTURED_PLAYER),
			options: [playbackOrderOf(CAPTURED_PLAYER.playbackMode)],
			playbackState: "stopped",
			activeItem: { ...IDLE_ITEM },
			...player,
		},
		playQueue: [] as QueuedEntry[],
		latency: 0,
		skipDelayMs: 0,
		requests: [] as RecordedRequest[],
		// Same bound as the component's; `fooJean/stream.ts` puts these on the stream clock.
		streamMarks: [] as StreamMark[],
		libraryFeed: {
			structure: 0,
			revision: 0,
			columns: [] as string[],
			building: null as string[] | null,
			buildTicks: 0,
			edits: 0,
			changes: new Map<string, number>(),
		},
	};

	const fake = fooJeanState(fooJean);

	const sessions = createSessions({ evaluate, marksKept: STREAM_MARKS });

	const sessionHeld = (id: string) => {
		const session = sessions.find(id);
		if (!session) throw new Error(`fake fooJean: holds no session ${id}`);
		return session;
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

	// foobar2000 answers a cover out of the file it was asked about, so a track
	// whose own tags carry another sleeve answers with that one. `embeddedArt` is
	// how a fixture states one, keyed by title the way `retagged` is.
	const ownArt = new Map(Object.entries(embeddedArt));

	const coverOfTrack = (track: Track) => {
		const own = ownArt.get(track["%title%"] ?? "");
		if (own) return own;

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

	let timelineRevision = 0;

	const mark = (track: Track, position: number) => {
		const path = String(evaluate(track, "%path%") ?? "");
		const lay = (announce: boolean) => {
			state.streamMarks = [
				...state.streamMarks.slice(1 - STREAM_MARKS),
				{ atMs: Date.now(), path, subsong: 0, position },
			];
			if (fake.canStream && fake.streamFormats.length > 0) {
				timelineRevision += 1;
				if (announce) playerVersion += 1;
			}
		};
		if (fake.markDelayMs > 0) setTimeout(() => lay(true), fake.markDelayMs);
		else lay(false);
	};

	// What the component's own store holds: the playing file, where it sits and
	// how long it is. `PlayerStateStore` in `plugins/fb2k/src/core/player_state.cpp`
	// clears it on a stop and on nothing else.
	let playing: {
		track: Track;
		playlistId: string;
		index: number;
		duration: number;
	} | null = null;
	let announced: Track | null = null;

	const named = (track: Track | null) =>
		track && announced ? { ...track, ...announced } : track;

	const activeTrack = () => {
		const item = state.player.activeItem;
		return playing?.track ?? byId(item.playlistId)?.items[item.index] ?? null;
	};

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
		playlist.structure += 1n;
		playlist.revision += 1n;
		playlist.changeHistory = [{ revision: playlist.revision, positions: [] }];
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
			duration,
			index,
			playlistId: playlist.id,
			position: 0,
		};
		state.player.playbackState = playbackState;
		markPosition(0);
		// Playing from a playlist makes it the current one, as the player does.
		for (const entry of state.playlists) entry.isCurrent = entry === playlist;
		notify({ player: true, playlists: true, playQueue: dequeued });
	};

	const afterSkipDelay = (play: () => void) => {
		if (state.skipDelayMs <= 0) return play();
		setTimeout(play, state.skipDelayMs);
	};

	const step = (delta: number) => {
		// The queue outranks both playback order and the playlist.
		const queued = delta > 0 ? state.playQueue[0] : null;
		if (queued) {
			const from = queued.playlistId ? byId(queued.playlistId) : null;
			const at = from?.items.indexOf(queued.track) ?? -1;
			if (from && at >= 0) {
				afterSkipDelay(() => setActive(from, at, "playing"));
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
		afterSkipDelay(() => setActive(playlist, next, "playing"));
	};

	const pause = () => {
		if (state.player.playbackState !== "playing") return;
		state.player.playbackState = "paused";
		markPosition(state.player.activeItem.position);
		notify({ player: true });
	};

	const resume = () => {
		const { playbackState, activeItem } = state.player;
		if (playbackState === "playing") return;
		if (playbackState === "stopped") {
			// Stopped-then-play resumes the current playlist from the top, which is
			// what foobar does with no active item.
			const playlist =
				state.playlists.find((entry) => entry.isCurrent) ?? state.playlists[0];
			if (playlist?.items.length)
				setActive(playlist, Math.max(activeItem.index, 0), "playing");
			return;
		}
		state.player.playbackState = "playing";
		markPosition(activeItem.position);
		notify({ player: true });
	};

	const feed = state.libraryFeed;
	fakesCreated += 1;
	const firstStructure =
		STRUCTURE_BASE_OF_THIRTEEN_DIGITS + fakesCreated * STRUCTURES_PER_FAKE;

	const PLAY_COUNT = "%lastfm_play_count%";
	const LAST_PLAYED = "%lastfm_last_played%";

	let tracksVersion = 0;

	interface Numbered {
		version: number;
		entries: LibraryEntry[];
		firstOrdinalOf: Map<string, number>;
		ordinalOfKey: Map<string, number>;
		rootDepth: number;
		// The first library entry at each relative path, and every entry at a path a cue sheet or a
		// second root repeats.
		entryAtPath: Map<string, LibraryEntry>;
		entriesAtRepeatedPath: Map<string, LibraryEntry[]>;
	}
	let numbered: Numbered | null = null;

	function* numberingSweep(): Sweep<Numbered | null> {
		const version = tracksVersion;
		// The list as it stands now: tracks added or removed while the sweep yields change
		// `libraryTracks` in place, and a sweep reading it across a yield would read a moved array.
		const tracks = libraryTracks.slice();
		const rootDepth = (yield* libraryRootSweep(tracks)).length;
		if (version !== tracksVersion) return null;
		const items = yield* libraryItemsSweep(tracks, rootDepth);
		if (version !== tracksVersion) return null;
		const entries = yield* sortedByLibraryPath(items);
		if (version !== tracksVersion) return null;
		const firstOrdinalOf = new Map<string, number>();
		const ordinalOfKey = new Map<string, number>();
		const entryAtPath = new Map<string, LibraryEntry>();
		const entriesAtRepeatedPath = new Map<string, LibraryEntry[]>();
		for (let at = 0; at < items.length; at += 1) {
			const item = items[at];
			const first = entryAtPath.get(item.path);
			if (!first) entryAtPath.set(item.path, item);
			else {
				const repeated = entriesAtRepeatedPath.get(item.path);
				if (repeated) repeated.push(item);
				else entriesAtRepeatedPath.set(item.path, [first, item]);
			}
			if (at % CHUNK === CHUNK - 1) yield;
		}
		for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
			const entry = entries[ordinal];
			const key = trackKey(entry.track);
			if (!ordinalOfKey.has(key)) ordinalOfKey.set(key, ordinal);
			const path = entry.track["%path%"];
			if (path !== undefined && !firstOrdinalOf.has(path))
				firstOrdinalOf.set(path, ordinal);
			if (ordinal % CHUNK === CHUNK - 1) yield;
		}
		return version === tracksVersion
			? {
					version,
					entries,
					firstOrdinalOf,
					ordinalOfKey,
					rootDepth,
					entryAtPath,
					entriesAtRepeatedPath,
				}
			: null;
	}

	const numberingIsCurrent = () => numbered?.version === tracksVersion;

	const numberedLibrary = (): Numbered => {
		if (numbered && numberingIsCurrent()) return numbered;
		for (;;) {
			const made = runToEnd(numberingSweep());
			if (made) {
				numbered = made;
				return made;
			}
		}
	};

	const ordinalOrder = (): readonly LibraryEntry[] => numberedLibrary().entries;

	const previewMatches = (query: string): number[] => {
		const matches = queryMatcher(query);
		if (!matches) return [];
		return ordinalOrder().flatMap((entry, ordinal) =>
			matches(entry.track) ? [ordinal] : [],
		);
	};

	interface Held<T> {
		key: string;
		value: T;
	}

	const columnKey = (expression: string) =>
		[tracksVersion, feed.edits, feed.changes.get(expression) ?? 0].join(
			"\u0000",
		);

	type Facts = Pick<Column, "distinct" | "hasUnresolved" | "allUnresolved">;

	const factsOf = (seen: ReadonlySet<string>): Facts => ({
		distinct: seen.size,
		hasUnresolved: seen.has(UNRESOLVED),
		allUnresolved: seen.size === 1 && seen.has(UNRESOLVED),
	});

	const SPINE = ["directory", "filename", "subsong"] as const;
	type Spine = Record<(typeof SPINE)[number], string>;

	const cutAt = (path: string) => path.lastIndexOf("/") + 1;
	const spineOf = (entry: LibraryEntry): Spine => ({
		directory: entry.path.slice(0, cutAt(entry.path)),
		filename: entry.path.slice(cutAt(entry.path)),
		subsong: String(entry.subsong),
	});

	const factsHeld = new Map<string, Held<Facts>>();
	let spineFactsHeld: Held<Record<(typeof SPINE)[number], Facts>> | null = null;

	function* numberedSweep(): Sweep<Numbered> {
		while (!numberingIsCurrent()) {
			const made = yield* numberingSweep();
			if (made) numbered = made;
		}
		return numbered as Numbered;
	}

	function* factsSweep(expression: string): Sweep<Facts> {
		for (;;) {
			const key = columnKey(expression);
			const kept = factsHeld.get(expression);
			if (kept?.key === key) return kept.value;
			const values = yield* valuesSweep(expression);
			const seen = new Set<string>();
			for (let at = 0; at < values.length; at += 1) {
				seen.add(values[at]);
				if (at % CHUNK === CHUNK - 1) yield;
			}
			const value = factsOf(seen);
			if (key === columnKey(expression)) {
				factsHeld.set(expression, { key, value });
				return value;
			}
		}
	}

	function* spineFactsSweep(): Sweep<Record<(typeof SPINE)[number], Facts>> {
		for (;;) {
			const key = String(tracksVersion);
			if (spineFactsHeld?.key === key) return spineFactsHeld.value;
			const { entries } = yield* numberedSweep();
			const seen = {
				directory: new Set<string>(),
				filename: new Set<string>(),
				subsong: new Set<string>(),
			};
			for (let at = 0; at < entries.length; at += 1) {
				const parts = spineOf(entries[at]);
				for (const name of SPINE) seen[name].add(parts[name]);
				if (at % CHUNK === CHUNK - 1) yield;
			}
			const value = {
				directory: factsOf(seen.directory),
				filename: factsOf(seen.filename),
				subsong: factsOf(seen.subsong),
			};
			if (key === String(tracksVersion)) {
				spineFactsHeld = { key, value };
				return value;
			}
		}
	}

	// A column's value at every ordinal, and the parts of every path, held until the tracks or a tag
	// the column reads moves: an answer that reads them again finds the same arrays, which is what
	// lets what is derived from them be held beside them.
	const valuesHeld = new Map<string, Held<string[]>>();
	let partsHeld: Held<{
		directory: string[];
		filename: string[];
		subsong: string[];
		paths: string[];
	}> | null = null;

	function* valuesSweep(expression: string): Sweep<string[]> {
		for (;;) {
			const key = columnKey(expression);
			const kept = valuesHeld.get(expression);
			if (kept?.key === key) return kept.value;
			const { entries } = yield* numberedSweep();
			const values = yield* mapped(entries, (entry) =>
				String(evaluate(entry.track, expression)),
			);
			if (key === columnKey(expression)) {
				valuesHeld.set(expression, { key, value: values });
				return values;
			}
		}
	}

	function* partsSweep() {
		for (;;) {
			const key = String(tracksVersion);
			if (partsHeld?.key === key) return partsHeld.value;
			const { entries } = yield* numberedSweep();
			const value = {
				directory: yield* mapped(entries, (entry) => spineOf(entry).directory),
				filename: yield* mapped(entries, (entry) => spineOf(entry).filename),
				subsong: yield* mapped(entries, (entry) => spineOf(entry).subsong),
				paths: yield* mapped(entries, (entry) => entry.path),
			};
			if (key === String(tracksVersion)) {
				partsHeld = { key, value };
				return value;
			}
		}
	}

	// The columns a read of these roles holds, the same object until one of them moves.
	const readsHeld = new Map<string, Held<Record<string, string[]>>>();
	function* columnsReadSweep(
		roles: ReadonlyMap<string, string>,
	): Sweep<Record<string, string[]>> {
		const rolesKey = [...roles]
			.map(([role, expression]) => `${role}=${expression}`)
			.sort()
			.join("\u0000");
		const keyNow = () => [...roles.values()].map(columnKey).join("\u0001");
		for (;;) {
			const key = keyNow();
			const kept = readsHeld.get(rolesKey);
			if (kept?.key === key) return kept.value;
			const columns: Record<string, string[]> = {};
			for (const [role, expression] of roles)
				columns[role] = yield* valuesSweep(expression);
			if (key === keyNow()) {
				readsHeld.set(rolesKey, { key, value: columns });
				return columns;
			}
		}
	}

	function* builtSweep(): Sweep<void> {
		yield* numberedSweep();
		for (const expression of feed.columns) yield* factsSweep(expression);
		yield* spineFactsSweep();
	}

	let discarded = false;
	// What an answer wants held before it is asked again, run once a large library has been read anew.
	let whenBuilt: (() => void) | null = null;

	let numbering: Promise<void> | null = null;
	let preparing: Promise<void> | null = null;

	const preparedNumbering = (): Promise<void> => {
		if (numberingIsCurrent()) return Promise.resolve();
		numbering ??= runYielding(numberedSweep(), () => discarded)
			.then(() => undefined)
			.finally(() => {
				numbering = null;
			});
		return numbering;
	};

	const prepared = (builtToo: boolean): Promise<void> => {
		if (!builtToo) return preparedNumbering();
		preparing ??= preparedNumbering()
			.then(() => runYielding(builtSweep(), () => discarded))
			.finally(() => {
				preparing = null;
			});
		return preparing;
	};

	function startLibraryBuild(columns: string[]) {
		feed.building = [...columns];
		feed.buildTicks = 0;
	}

	const pendingChange = { add: 0, remove: 0 };
	let addedSoFar = 0;

	const newTrackBesides = (neighbour: Track): Track => {
		addedSoFar += 1;
		const directory = (neighbour["%path%"] ?? "").replace(/[^\\]*$/, "");
		const added: Track = {
			...neighbour,
			"%title%": `Added track ${addedSoFar} (new)`,
			"%path%": `${directory}Added ${addedSoFar}.mp3`,
		};
		delete added["%subsong%"];
		if (PLAY_COUNT in added) added[PLAY_COUNT] = "0";
		if ("$meta(title)" in added) added["$meta(title)"] = added["%title%"];
		return added;
	};

	function changeLibrary({ add, remove }: { add: number; remove: number }) {
		pendingChange.add += add;
		pendingChange.remove += remove;
		if (feed.columns.length > 0) startLibraryBuild(feed.columns);
		else applyPendingChange();
	}

	function applyPendingChange() {
		const { add, remove } = pendingChange;
		pendingChange.add = 0;
		pendingChange.remove = 0;
		if (add === 0 && remove === 0) return;

		const { entries } = numberedLibrary();
		const dropped = new Set(
			entries.slice(Math.max(0, entries.length - remove)).map((e) => e.track),
		);
		const neighbour = entries[0]?.track ?? libraryTracks[0];
		const additions = neighbour
			? Array.from({ length: add }, () => newTrackBesides(neighbour))
			: [];

		let kept = 0;
		for (const track of libraryTracks)
			if (!dropped.has(track)) libraryTracks[kept++] = track;
		libraryTracks.length = kept;
		for (const track of additions) libraryTracks.push(track);
		tracksVersion += 1;
		// What was read off the old list is let go before the new one is read, not after.
		valuesHeld.clear();
		factsHeld.clear();
		readsHeld.clear();
		partsHeld = null;
		spineFactsHeld = null;
	}

	function finishLibraryBuild() {
		if (!feed.building) return;
		applyPendingChange();
		feed.columns = feed.building;
		feed.building = null;
		feed.structure = feed.structure === 0 ? firstStructure : feed.structure + 1;
		feed.revision += 1;
		// A component reads the library when it builds it, not when it is first asked.
		if (libraryTracks.length > SYNC_SWEEP_LIMIT)
			void prepared(true).then(() => whenBuilt?.());
	}

	function countChange(column: string) {
		feed.changes.set(column, (feed.changes.get(column) ?? 0) + 1);
	}

	function countPlay(track: Track) {
		if (!countsPlays) return;

		const path = track["%path%"];
		const ordinal =
			path === undefined
				? undefined
				: numberedLibrary().firstOrdinalOf.get(path);
		if (ordinal !== undefined) countPlayAt(ordinal);
	}

	function countPlayAt(ordinal: number, given?: number | string) {
		if (!feed.columns.includes(PLAY_COUNT)) return false;

		const { entries } = numberedLibrary();
		if (!(ordinal >= 0 && ordinal < entries.length)) return false;

		const row = entries[ordinal].track;
		const path = row["%path%"];
		const count = String(given ?? Number(row[PLAY_COUNT] ?? 0) + 1);
		const stamped = given === undefined && feed.columns.includes(LAST_PLAYED);
		const stamp = stamped ? localStampOf(new Date(Date.now())) : "";
		for (
			let at = ordinal;
			at < entries.length && entries[at].track["%path%"] === path;
			at += 1
		) {
			const { track } = entries[at];
			track[PLAY_COUNT] = count;
			if (stamped) track[LAST_PLAYED] = stamp;
		}
		for (const playlist of state.playlists)
			for (const copy of playlist.items)
				if (copy["%path%"] === path) {
					copy[PLAY_COUNT] = count;
					if (stamped) copy[LAST_PLAYED] = stamp;
				}
		feed.revision += 1;
		countChange(PLAY_COUNT);
		if (stamped) countChange(LAST_PLAYED);
		return true;
	}

	function libraryRows(ordinals: readonly number[]): Uint8Array<ArrayBuffer> {
		const { entries } = numberedLibrary();
		const named = ordinals.map((ordinal) => entries[ordinal]);
		const spine = runToEnd(spineFactsSweep());
		const spineWindow = (name: (typeof SPINE)[number]) =>
			windowOfValues(
				null,
				named.map((entry) => spineOf(entry)[name]),
				spine[name],
			);
		return encodeJlib({
			kind: "rows",
			structure: feed.structure,
			revision: feed.revision,
			trackCount: entries.length,
			rows: ordinals.length,
			columns: feed.columns.map((expression) =>
				windowOfValues(
					expression,
					named.map((entry) => String(evaluate(entry.track, expression))),
					runToEnd(factsSweep(expression)),
				),
			),
			spine: {
				directory: spineWindow("directory"),
				filename: spineWindow("filename"),
				subsong: spineWindow("subsong"),
			},
		});
	}

	const queuePayload = () =>
		state.playQueue.map((entry) => {
			const playlist = entry.playlistId ? byId(entry.playlistId) : null;
			return {
				playlistId: entry.playlistId ?? "",
				itemIndex: playlist ? playlist.items.indexOf(entry.track) : -1,
			};
		});

	return {
		player: state.player,
		latency: state.latency,
		get skipDelayMs() {
			return state.skipDelayMs;
		},
		set skipDelayMs(ms: number) {
			state.skipDelayMs = ms;
		},
		get playQueue() {
			return queuePayload();
		},
		requests: state.requests,
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
		get timelineRevision() {
			return timelineRevision;
		},
		queuedEntries,
		fooJean: fake,
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
			if (playlist && at >= 0) {
				playlist.items[at] = retagged;
				playlist.revision += 1n;
				playlist.changeHistory = [
					...playlist.changeHistory,
					{ revision: playlist.revision, positions: [at] },
				];
				if (playlist.changeHistory.length > fake.playlistChangeWindow + 1)
					playlist.changeHistory.shift();
				markPlaylistsChanged();
			}
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

		// Derived rather than set, so a fixture that starts with somebody already
		// listening starts muted, exactly as reconnecting to a running install would.
		get playerHeld(): boolean {
			if (!this.fooJean.canMuteWhileStreaming || this.holdReleased)
				return false;
			return this.streamDevices.size + this.fooJean.otherListeners.length > 0;
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

		artworkOfTrack: (track: Track | null) =>
			track ? coverOfTrack(track) : null,

		sessions,

		addSessionListener: (id: string, device: SessionDevice) =>
			sessionHeld(id).listen(device, fake.streamFormats[0] ?? "opus"),

		addSessionReport(id: string, track: Track) {
			sessionHeld(id).report("undecodable", track);
		},

		dropSessionChain(id: string) {
			sessionHeld(id).dropChain();
		},

		endSession(id: string) {
			sessions.end(sessionHeld(id));
		},

		playItem(playlistId: string, index: number) {
			const playlist = byId(playlistId);
			if (playlist) setActive(playlist, index, "playing");
		},

		playPause() {
			if (state.player.playbackState === "playing") pause();
			else resume();
		},

		pause,
		resume,

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

		// A switch landing, whether asked for through `POST /api/outputs/active` or made at the
		// player and mirrored here through `/__control/activeOutput`. Either way `outputDeviceId`
		// moves on the next poll rather than being written by the route that asked for it.
		setActiveOutput(deviceId: string | null) {
			fake.activeOutput = deviceId;
			notify({ player: true });
		},

		// The media library ordinals a query matches, ascending: in the order `ordinalOrder` numbers
		// them, the one a fill counts in. A query outside `queryMatcher`'s grammar matches nothing.
		previewMatches,

		previewTracks(query: string): Track[] {
			const order = ordinalOrder();
			return previewMatches(query).map((ordinal) => order[ordinal].track);
		},

		addPlaylist(title: string): PlaylistInfo {
			const used = state.playlists.map((entry) => Number(entry.id.slice(1)));
			const id = `p${Math.max(0, ...used) + 1}`;
			const playlist: FakePlaylist = {
				id,
				guid: guidOfDefault(nextCreatedGuid++),
				title: title || "New playlist",
				isCurrent: false,
				structure: GENERATION_SEED,
				revision: GENERATION_SEED,
				changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
				items: [],
			};
			state.playlists.push(playlist);
			notify({ playlists: true });
			return {
				id,
				index: state.playlists.length - 1,
				itemCount: 0,
				title: playlist.title,
				structure: String(playlist.structure),
				revision: String(playlist.revision),
				role: null,
				isAutoPlaylist: false,
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

		copyItems(sourceId: string, targetId: string, indices: number[]) {
			const source = byId(sourceId);
			const target = byId(targetId);
			if (!source || !target || target.isAuto) return false;
			// Appended without a duplicate check and in the source's order rather than the
			// caller's, because that is what the player does.
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

		libraryRows,

		libraryEdited(fields: string[]) {
			state.libraryFeed.edits += 1;
			state.libraryFeed.revision += 1;
			for (const column of state.libraryFeed.columns)
				if (fields.some((field) => readsField(column, field)))
					countChange(column);
		},

		libraryOrdinalFor(track: Track | null) {
			if (!track) return null;
			if (!numberingIsCurrent() && libraryTracks.length > SYNC_SWEEP_LIMIT) {
				void prepared(false);
				return null;
			}
			return numberedLibrary().ordinalOfKey.get(trackKey(track)) ?? null;
		},

		valuesSweep,
		partsSweep,
		columnsReadSweep,
		isDiscarded: () => discarded,
		afterLargeBuild(callback: () => void) {
			whenBuilt = callback;
		},
		discard() {
			discarded = true;
		},
		settledNumbering: () => prepared(false),
		settledLargeNumbering() {
			if (libraryTracks.length > SYNC_SWEEP_LIMIT) void prepared(false);
		},
		settledLibrary: () => prepared(true),

		libraryChangeCounts() {
			return state.libraryFeed.columns.map(
				(column) => state.libraryFeed.changes.get(column) ?? 0,
			);
		},

		startLibraryBuild,
		finishLibraryBuild,
		changeLibrary,

		countPlay,
		countPlayAt,

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
				const before = playlist.items;
				const order = sortedOrder(before, by);
				if (desc) order.reverse();
				playlist.items = order.map((old) => before[old]);
			});

			notify({ playlists: true });
			return true;
		},

		libraryArtworkFor(path: string) {
			const entry = numberedLibrary().entryAtPath.get(path);
			return entry ? coverOfTrack(entry.track) : null;
		},

		libraryEntriesAt(path: string): readonly LibraryEntry[] {
			const held = numberedLibrary();
			const repeated = held.entriesAtRepeatedPath.get(path);
			if (repeated) return repeated;
			const entry = held.entryAtPath.get(path);
			return entry ? [entry] : [];
		},

		libraryPathFor(track: Track) {
			// A state poll names the playing track's path against the numbering it finds, and does
			// not wait for a library too large to number in one turn to be numbered again.
			const held =
				numberingIsCurrent() || libraryTracks.length <= SYNC_SWEEP_LIMIT
					? numberedLibrary()
					: numbered;
			if (!held) return null;
			return held.ordinalOfKey.has(trackKey(track))
				? libraryPathOf(track, held.rootDepth)
				: null;
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

export { postsToSession } from "./sessions.ts";
export { DEFAULT_PLAYLISTS };
