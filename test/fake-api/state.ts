import type {
	LibraryInfo,
	PlayerState,
	PlaylistInfo,
} from "../../src/shared/api/types.ts";
import { type FooJeanOptions, fooJeanState } from "./fooJean.ts";
import capturedLibrary from "./library.json" with { type: "json" };
import capturedPlayer from "./player.json" with { type: "json" };

// A captured track: a title-formatting expression to the value the player
// answered with. A missing key is a field this player cannot resolve, which
// `evaluate` turns back into '?'.
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

// What the fake holds, not what it serves: `PlaylistInfo` carries a count
// rather than the items.
export interface FakePlaylist {
	id: string;
	title: string;
	isCurrent: boolean;
	items: Track[];
	// Never served: `PlaylistInfo` does not say which kind of playlist this is.
	// A write to an autoplaylist answers 204 and is ignored, as on the real player.
	isAuto?: boolean;
}

export interface LibraryEntry {
	track: Track;
	path: string;
	subsong: number;
}

interface CapturedAlbum {
	slug: string;
	artwork?: string;
	tracks: Track[];
}

// beefweb pushes only what changed, so every key is optional and never false.
interface Changed {
	player?: boolean;
	playlists?: boolean;
	playQueue?: boolean;
}

export interface RecordedRequest {
	method: string;
	path: string;
	// Loose on purpose: a spec reads whichever field the request it asserts on
	// carries.
	// biome-ignore lint/suspicious/noExplicitAny: see above
	body: Record<string, any> | null;
}

// Imported rather than read off disk: the fake also runs in a service worker for
// the demo build, which has no filesystem.
const LIBRARY = capturedLibrary as { albums: CapturedAlbum[] };
const CAPTURED_PLAYER = capturedPlayer as unknown as PlayerState;

// beefweb reports index -1 rather than omitting activeItem when nothing is
// playing, so the app tests `index >= 0`.
const IDLE_ITEM = {
	columns: [],
	duration: -1,
	index: -1,
	playlistId: "",
	playlistIndex: -1,
	position: -1,
};

// What a manual skip pushes while the player opens the next file. Not `IDLE_ITEM`: the two agree on `index: -1` and
// disagree on the rest, and the gap is reported with `playbackState` still `playing`. See API.md.
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

// Ids are not contiguous and not in index order: on a real install, creating one
// playlist produced p7, not p6.
// A library-sized playlist synthesised from the captured tracks, for behaviour
// that only appears past a few thousand rows.
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

// A library of a stated shape, for what varies between collections: size,
// albums, artists, genres, track length, the years it spans. Built from a
// captured track, so `omit` drops a tag entirely -- which is not the same as
// blanking it, since a field the player cannot resolve answers '?'.
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
}: {
	tracks?: number;
	albums?: number;
	artists?: number;
	genres?: number;
	seconds?: number;
	years?: [number, number];
	omit?: string[];
	mixedCase?: boolean;
} = {}): Track[] {
	const template = allTracks()[0];
	const [first, last] = years;
	const built: Track[] = new Array(tracks);

	for (let index = 0; index < tracks; index += 1) {
		// An album belongs to one artist, so the artist follows the album.
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
			// Under the same root the capture uses, so the library-relative paths
			// still come out the way a real player reports them.
			"%path%": `C:\\Music\\S\\Artist ${artist + 1}\\Album ${album + 1}\\${index + 1}.mp3`,
		};

		for (const field of omit) delete track[field];
		built[index] = track;
	}

	return built;
}

// ---- media library (beefweb 0.11+) -------------------------------------
//
// Every captured track sits under the one media library folder the fixtures use, so
// library-relative paths derive from `%path%`: strip the root, flip separators.
// The live player returns them `/`-separated even on Windows, where
// `pathSeparator` is `\` -- `B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3`.

// The deepest directory every track shares, which is what foobar2000 would have
// been pointed at.
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
		// The capture holds no cue sheets or disc images, so every track is its own
		// file and every subsong is 0.
		subsong: 0,
	}));
}

const DEFAULT_PLAYLISTS = (): FakePlaylist[] => [
	{
		id: "p1",
		title: "Default Playlist",
		isCurrent: false,
		items: tracksOf("jar-of-flies").slice(0, 4),
	},
	{ id: "p7", title: "Library", isCurrent: true, items: allTracks() },
	{
		id: "p2",
		title: "Favorites",
		isCurrent: false,
		items: [
			...tracksOf("deja-entendu").slice(0, 3),
			...tracksOf("jessico").slice(0, 2),
			...tracksOf("deathconsciousness").slice(0, 2),
		],
	},
	{
		id: "p5",
		title: "Rock en Español",
		isCurrent: false,
		items: tracksOf("jessico"),
	},
	// The autoplaylist a user makes when Jean asks them to, and the only way to see
	// a library on a player without the media library API. It sits beside an
	// ordinary playlist called 'Library', so nothing may adopt a playlist by title.
	{ id: "p8", title: "#Jean Library", isCurrent: false, items: allTracks() },
	// A visible autoplaylist with an ordinary name: `#Jean Library` above is hidden
	// from the sidebar and the add-to-playlist menu, so no write can reach it.
	{
		id: "p9",
		title: "Recently Added",
		isCurrent: false,
		isAuto: true,
		items: tracksOf("jar-of-flies").slice(0, 5),
	},
];

// An expression the player cannot resolve comes back as '?'; one that resolves
// to nothing comes back as ''. Capability detection rests on the difference.
export const evaluate = (track: Track, expression: string) =>
	track[expression] ?? "?";

const columnsFor = (track: Track, expressions: string[]) =>
	expressions.map((expression) => evaluate(track, expression));

// The library reports a relative `/`-joined path and the player an absolute
// Windows one. The common root cancels; the separator does not.
const pathKey = (value: unknown) => String(value).replace(/\\/g, "/");

// How the media library hands a set back: album artist, album, track number.
// Not the path order the library endpoint pages in.
const browseOrder = (a: Track, b: Track) =>
	String(evaluate(a, "%album artist%")).localeCompare(
		String(evaluate(b, "%album artist%")),
	) ||
	String(evaluate(a, "%album%")).localeCompare(
		String(evaluate(b, "%album%")),
	) ||
	String(evaluate(a, "%tracknumber%")).localeCompare(
		String(evaluate(b, "%tracknumber%")),
	);

export function createState({
	playlists = DEFAULT_PLAYLISTS(),
	player,
	librarySize,
	// The media library the 0.11 API serves. Distinct from `librarySize`, which
	// inflates an ordinary playlist; this also replaces `#Jean Library`.
	mediaLibrarySize,
	// The media library stated outright. See `libraryOfShape`.
	mediaLibrary,
	// Expressions this player cannot resolve. Dropping them makes evaluate() answer
	// '?', as a real player does for a field no component provides.
	withoutFields = [],
	// `supported: false` is DeaDBeeF, where every library endpoint answers 501.
	// `enabled: false` is foobar2000 with no media library configured.
	library = {},
	// Tag values the capture does not carry, keyed by track title: it holds no
	// featured artist and no compilation.
	retagged = {},
	// The optional tag-writing component; see `fooJean.ts` for its states.
	fooJean = null,
	// Where a track's cover comes from when it is not one of the captured ones.
	// Absent, a track outside the capture has no cover.
	artworkOf = null,
}: {
	playlists?: FakePlaylist[];
	// Null as well as absent, because the Playwright fixtures default every
	// option to null rather than leaving it out.
	player?: Partial<PlayerState> | null;
	librarySize?: number | null;
	mediaLibrarySize?: number | null;
	mediaLibrary?: Track[] | null;
	withoutFields?: string[];
	library?: Partial<LibraryInfo>;
	retagged?: Record<string, Track>;
	fooJean?: FooJeanOptions | null;
	artworkOf?: ((track: Track) => string | null) | null;
} = {}) {
	const patches = Object.entries(retagged);
	if (patches.length > 0) {
		const byTitle = new Map(patches);
		for (const playlist of playlists) {
			playlist.items = playlist.items.map((track) => {
				const patch = byTitle.get(track["%title%"]);
				return patch ? { ...track, ...patch } : track;
			});
		}
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

	const libraryTracks = mediaLibrary
		? mediaLibrary
		: mediaLibrarySize
			? generateTracks(mediaLibrarySize)
			: withoutFields.length > 0
				? allTracks().map(strip)
				: allTracks();

	if (mediaLibrary || mediaLibrarySize) {
		const autoplaylist = playlists.find(
			(entry) => entry.title === "#Jean Library",
		);
		if (autoplaylist) autoplaylist.items = libraryTracks;
	}

	// Inflates the ordinary playlist the browsing specs open, not the autoplaylist
	// search reads. The media library the API serves is the captured one either way.
	if (librarySize) {
		const library = playlists.find((entry) => entry.title === "Library");
		if (library) library.items = generateTracks(librarySize);
	}

	const listeners = new Set<(message: Changed) => void>();

	const state = {
		playlists,
		// Volume and playback order come off the real player; what is playing does not,
		// because the captured track is not in the fixture.
		player: {
			...structuredClone(CAPTURED_PLAYER),
			playbackState: "stopped",
			activeItem: { ...IDLE_ITEM },
			...player,
		},
		// The track, not its position, which is what foobar2000 holds: the index is
		// looked up on read.
		playQueue: [] as { playlistId: string; track: Track }[],
		library: { supported: true, enabled: true, ...library },
		// Milliseconds to hold a write before answering. See POST /__control/latency.
		latency: 0,
		// Milliseconds a skip spends reporting `GAP_ITEM`. Off by default: the gap is asynchronous, and a spec that
		// does not assert on it should not have to wait for one. See POST /__control/skipGap.
		skipGapMs: 0,
		// Every request the app made, in order.
		requests: [] as RecordedRequest[],
		// Where each of the last few tracks began, in wall-clock milliseconds;
		// `fooJean.ts` puts them on the stream clock. Same bound as the component's.
		streamMarks: [] as StreamMark[],
	};

	// beefweb pushes on change and never on a timer, so there is no interval behind
	// this. Position advances in the app's own interpolation.
	const notify = (changed: Changed) => {
		const message: Changed = {};
		if (changed.player) message.player = true;
		if (changed.playlists) message.playlists = true;
		if (changed.playQueue) message.playQueue = true;
		for (const listener of listeners) listener(message);
	};

	const byId = (id: string) =>
		state.playlists.find((entry) => entry.id === id) ?? null;

	// A queued track leaves the queue when it starts.
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

	// A track began, or the player moved within one. Both change what a given
	// stream time means, so the component marks both.
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

	const setActive = (
		playlist: FakePlaylist,
		index: number,
		playbackState: PlayerState["playbackState"],
	) => {
		const track = playlist.items[index];
		if (!track) return;
		mark(track, 0);
		const dequeued = consume(playlist, index);
		state.player.activeItem = {
			columns: [],
			duration: Number(evaluate(track, "%length_seconds%")) || 0,
			index,
			playlistId: playlist.id,
			playlistIndex: state.playlists.indexOf(playlist),
			position: 0,
		};
		state.player.playbackState = playbackState;
		// Playing from a playlist makes it the current one, as the player does.
		for (const entry of state.playlists) entry.isCurrent = entry === playlist;
		notify({ player: true, playlists: true, playQueue: dequeued });
	};

	// See GAP_ITEM.
	const withSkipGap = (play: () => void) => {
		if (state.skipGapMs <= 0) return play();
		state.player.activeItem = { ...GAP_ITEM };
		notify({ player: true });
		setTimeout(play, state.skipGapMs);
	};

	const step = (delta: number) => {
		// The queue outranks both playback order and the playlist.
		const queued = delta > 0 ? state.playQueue[0] : null;
		if (queued) {
			const from = byId(queued.playlistId);
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

	// An orphan's columns are still the removed track's: the real player hands back
	// whatever fell into the freed slot.
	const queuePayload = (expressions: string[] = []) =>
		state.playQueue.map((entry) => {
			const playlist = byId(entry.playlistId);
			return {
				playlistId: entry.playlistId,
				playlistIndex: playlist ? state.playlists.indexOf(playlist) : -1,
				itemIndex: playlist ? playlist.items.indexOf(entry.track) : -1,
				columns: columnsFor(entry.track, expressions),
			};
		});

	return {
		// Named rather than spread: mutations work in place, but a spread would copy
		// `playlists` and detach it the first time something reassigned the array.
		player: state.player,
		// On the facade as well as the inner state: the router reads it before every
		// write and the control surface assigns to it.
		latency: state.latency,
		// Accessors rather than a copy: `step` reads this from inside the closure, long after the control surface set it.
		get skipGapMs() {
			return state.skipGapMs;
		},
		set skipGapMs(ms: number) {
			state.skipGapMs = ms;
		},
		// What the player would report, rather than the track objects held inside.
		get playQueue() {
			return queuePayload();
		},
		requests: state.requests,
		// A getter because `mark` replaces the array rather than pushing into it.
		get streamMarks() {
			return state.streamMarks;
		},
		library: state.library,
		fooJean: fooJeanState(fooJean),
		// Which `?format=` each stream was opened with, in order; `requests` records
		// paths without their query.
		streamFormats: [] as string[],
		// Somebody asked to hear the player alongside the listeners, either by
		// raising its fader — which is what `patchPlayer` watches for — or through
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
		// Separate objects from the playlists' whenever `withoutFields` is in play,
		// so a tag write has to reach both.
		libraryTracks,
		get playlists() {
			return state.playlists;
		},

		// The hold is a volume, so a client watching the player sees it change. The
		// real one has nothing to announce: foobar2000's own volume moved, and
		// beefweb pushes that like any other.
		announceHold() {
			notify({ player: true });
		},

		subscribe(listener: (message: Changed) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		record(method: string, path: string, body: RecordedRequest["body"]) {
			state.requests.push({ method, path, body });
		},

		playlistById: byId,

		// The six fields PlaylistInfo has, no more. totalTime is 0 because the real
		// player returns 0, however long the playlist runs.
		playlistsPayload: () =>
			state.playlists.map((entry, index) => ({
				id: entry.id,
				index,
				isCurrent: entry.isCurrent,
				itemCount: entry.items.length,
				title: entry.title,
				totalTime: 0,
			})),

		// True while the component is silencing the player for a listener. Derived
		// rather than set, so a fixture that starts with somebody already listening
		// starts muted, exactly as reconnecting to a running install would.
		// `this` rather than `state`: these live on the object being built here,
		// where `state` is the raw one it is built from.
		get playerHeld(): boolean {
			if (!this.fooJean.canMuteWhileStreaming || this.holdReleased)
				return false;
			return this.streamDevices.size + this.fooJean.otherListeners.length > 0;
		},

		playerPayload(trcolumns: string[] = []) {
			const item = state.player.activeItem;
			const playlist = item.index >= 0 ? byId(item.playlistId) : null;
			const track = playlist?.items[item.index];
			return {
				...state.player,
				// foobar2000 has no mute flag -- mute is the volume at -100 dB -- so a
				// hold the component takes for a listener is visible to every beefweb
				// client, and Jean is built on exactly that being true.
				volume: this.playerHeld
					? { ...state.player.volume, isMuted: true, value: -100 }
					: state.player.volume,
				activeItem: {
					...item,
					columns: track ? columnsFor(track, trcolumns) : [],
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

		artworkFor(playlistId: string, index: number) {
			const track = byId(playlistId)?.items[index];
			if (!track) return null;
			const album = LIBRARY.albums.find((entry) =>
				entry.tracks.some(
					(candidate) => candidate["%path%"] === track["%path%"],
				),
			);
			return album?.artwork ?? artworkOf?.(track) ?? null;
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
			notify({ player: true });
		},

		stop() {
			state.player.playbackState = "stopped";
			state.player.activeItem = { ...IDLE_ITEM };
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
				playbackState?: PlayerState["playbackState"];
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
			// A seek is a mark: the same stream time now means a different place in
			// the track.
			if (item.position !== before) {
				const track = byId(item.playlistId)?.items[item.index];
				if (track) mark(track, item.position);
			}
			if (body.volume != null) {
				state.player.volume.value = body.volume;
				// Mute is the volume, so a fader moved off the floor is how the
				// component learns the mute it took is no longer its own -- and it
				// never takes it again inside the same spell of listening.
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

		addPlaylist(title: string): PlaylistInfo {
			// Ids keep climbing and are never reused, as the player's do.
			const used = state.playlists.map((entry) => Number(entry.id.slice(1)));
			const id = `p${Math.max(0, ...used) + 1}`;
			const playlist: FakePlaylist = {
				id,
				title: title || "New playlist",
				isCurrent: false,
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
			// A negative index means last, per the spec.
			state.playlists.splice(
				index < 0 ? state.playlists.length : index,
				0,
				moved,
			);
			notify({ playlists: true });
			return true;
		},

		// Item changes push `player` and not `playlists`, as beefweb does: an add, a
		// rename or a delete produces a `playlists` message; a copy or a remove of items
		// does not. So `itemCount` in PlaylistInfo goes stale from the first write on.
		copyItems(sourceId: string, targetId: string, indices: number[]) {
			const source = byId(sourceId);
			const target = byId(targetId);
			if (!source || !target) return false;
			// On foobar2000 2.25.3 a copy into an autoplaylist answers 204 exactly as a
			// copy into an ordinary playlist does, and adds nothing. Not a 404.
			if (target.isAuto) return true;
			// Appended without a duplicate check and in the source's order rather than the
			// caller's, because that is what the player does. `add-from-library` too, so it
			// is a property of the player rather than of one endpoint.
			const ordered = [...indices].sort((a, b) => a - b);
			target.items.push(
				...ordered.map((index) => source.items[index]).filter(Boolean),
			);
			notify({ player: true });
			return true;
		},

		removeItems(playlistId: string, indices: number[]) {
			const playlist = byId(playlistId);
			if (!playlist) return false;
			const drop = new Set(indices);
			playlist.items = playlist.items.filter((_, index) => !drop.has(index));
			// See copyItems: item changes do not push `playlists` on a real player.
			// They do move the queue: everything below a removed row renumbers.
			notify({ player: true, playQueue: true });
			return true;
		},

		// The playlists push a real player sends only when the set of playlists changes.
		notifyPlaylists() {
			notify({ playlists: true });
		},

		// ---- media library ---------------------------------------------------

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

			// Default order is file path, per the spec, which also warns library items are
			// "produced by applying search criteria rather than naturally ordered".
			const key =
				sort && sort !== "%path%"
					? (entry: LibraryEntry) => evaluate(entry.track, sort)
					: (entry: LibraryEntry) => entry.path;
			items.sort((a, b) => pathKey(key(a)).localeCompare(pathKey(key(b))));
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

		// One level of the tree, folders first with a recursive count, then tracks.
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

			// Byte-wise and case-sensitive, as the player is: 'Zappa' sorts before 'abba'.
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
			// See copyItems: an autoplaylist takes the request and drops it.
			if (playlist.isAuto) return true;

			const known = new Map(
				libraryItemsOf(libraryTracks).map((entry) => [entry.path, entry]),
			);
			// Omitting `items` adds the whole library, per the spec. The live player ignores
			// both the order asked for and the library's own path order: a set arrives in
			// the media library's browse order -- album artist, album, track number.
			const chosen = (
				items ?? [...known.values()].map((entry) => ({ path: entry.path }))
			)
				.map((ref) => known.get(ref.path))
				.filter((entry) => entry !== undefined)
				.sort((a, b) => browseOrder(a.track, b.track))
				.map((entry) => entry.track);

			if (replace) playlist.items = [];
			const at =
				index !== undefined && Number.isInteger(index)
					? index
					: playlist.items.length;
			playlist.items.splice(at, 0, ...chosen);

			notify({ playlists: true });
			if (play && chosen.length > 0) setActive(playlist, at, "playing");
			return true;
		},

		// `{ by, desc, random }`. The expression is evaluated per track, as the column
		// list is, so `%path%` sorts by path.
		sortItems(
			playlistId: string,
			{ by, desc, random }: { by: string; desc?: boolean; random?: boolean },
		) {
			const playlist = byId(playlistId);
			if (!playlist) return false;

			if (random) {
				playlist.items = [...playlist.items].sort(() => 0);
			} else {
				playlist.items = [...playlist.items].sort((a, b) =>
					pathKey(evaluate(a, by)).localeCompare(pathKey(evaluate(b, by))),
				);
				if (desc) playlist.items.reverse();
			}

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

		// `queueIndex` is accepted and ignored, as foobar2000 does.
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
