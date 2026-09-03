import type {
	LibraryInfo,
	PlayerState,
	PlaylistInfo,
} from "../../src/shared/api/types.ts";
import { type FooJeanOptions, fooJeanState } from "./fooJean.ts";
import capturedLibrary from "./library.json" with { type: "json" };
import capturedPlayer from "./player.json" with { type: "json" };

// A captured track: a title-formatting expression to the value the player
// answered with. A *missing* key is a field this player cannot resolve, which
// `evaluate` turns back into '?' -- that difference is the whole of capability
// detection, so it is modelled by absence rather than by a sentinel.
export type Track = Record<string, string>;

// Where the stream last changed what a given stream time means, in wall-clock
// milliseconds. Held as wall time so the state box does not need the listener
// half's epoch.
export interface StreamMark {
	atMs: number;
	path: string;
	subsong: number;
	position: number;
}

// Bounded, as the component's is: a client only ever needs the marks around
// what it is currently hearing.
const STREAM_MARKS = 6;

// A playlist as the fake holds it, which is not what it serves: `PlaylistInfo`
// has six fields and carries a count rather than the items.
export interface FakePlaylist {
	id: string;
	title: string;
	isCurrent: boolean;
	items: Track[];
	// The fake's own field, never served: `PlaylistInfo` has six and none of them
	// says which kind of playlist this is. It exists so writes behave the way the
	// real player's do -- accepted with a 204, and ignored. See `useAddTracks`.
	isAuto?: boolean;
}

// A track as the media library addresses it -- `(path, subsong)` -- paired with
// the track it resolves to.
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

// Which keys of the update stream this message carries. beefweb pushes only
// what changed, so both are optional and neither is ever false.
interface Changed {
	player?: boolean;
	playlists?: boolean;
	playQueue?: boolean;
}

export interface RecordedRequest {
	method: string;
	path: string;
	// Loose on purpose: a spec asserting on the wire reads whichever field the
	// request it is about carries, and what those are is the app's business.
	// biome-ignore lint/suspicious/noExplicitAny: see above
	body: Record<string, any> | null;
}

// Imported rather than read off disk, because the fake runs in two places now:
// `node` for the suite, and a service worker for the demo build, which has no
// filesystem to read. Both hosts resolve a JSON import.
const LIBRARY = capturedLibrary as { albums: CapturedAlbum[] };
const CAPTURED_PLAYER = capturedPlayer as unknown as PlayerState;

// beefweb reports index -1 rather than omitting activeItem when nothing is
// playing. API.md, and the app tests `index >= 0` for exactly this reason.
const IDLE_ITEM = {
	columns: [],
	duration: -1,
	index: -1,
	playlistId: "",
	playlistIndex: -1,
	position: -1,
};

const tracksOf = (album: string) =>
	LIBRARY.albums.find((entry) => entry.slug === album)?.tracks ?? [];
const allTracks = () => LIBRARY.albums.flatMap((album) => album.tracks);

// Ids are deliberately not contiguous and not in index order. That is what the
// real install looks like -- creating one playlist there produced p7, not p6 --
// and anything in the app that quietly assumes otherwise should fail here
// rather than on someone's machine.
// A library-sized playlist, synthesised from the captured tracks. The point is
// not the metadata -- it is that a library arrives in chunks rather than in one
// response, that the virtualiser is never holding more than a screenful, and
// that scroll offsets are computed over a list far taller than anything a
// hand-written fixture produces. Bugs that only appear past a few thousand rows
// have nowhere else to show up.
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

// A library of a stated *shape*, for the things that vary between one person's
// collection and the next: how big it is, how many records and artists and
// genres are in it, how long the tracks run, which years it spans. Jean is
// meant for anybody's library, and the captured one is tidy, mid-sized and
// thoroughly tagged -- which is exactly the library a bug about small,
// one-artist or untagged collections cannot appear in.
//
// Built from a real captured track so every field the app reads is present and
// plausible; only the ones a test is actually about are varied. `omit` drops a
// tag entirely, which is not the same as blanking it: a field the player cannot
// resolve answers '?', and that is the difference the whole capability
// detection rests on.
export function libraryOfShape({
	tracks = 12,
	albums = 1,
	artists = 1,
	genres = 1,
	seconds = 240,
	years = [2000, 2000],
	omit = [],
	// Two people tagged this: the same artist written two ways, differing in case
	// and in spacing. Real collections look like this the moment more than one
	// tool has touched them, and a count that reports it as two artists is
	// measuring the tagging rather than the music.
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
		// An album belongs to one artist, the way records do. Assigning both from
		// the track index independently gave "Album 1" three hundred different
		// artists and so three hundred times as many albums as asked for -- which
		// the app counted correctly and the fixture had lied about.
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
			"%path%": `F:\\Musica\\S\\Artist ${artist + 1}\\Album ${album + 1}\\${index + 1}.mp3`,
		};

		for (const field of omit) delete track[field];
		built[index] = track;
	}

	return built;
}

// ---- media library (beefweb 0.11+) -------------------------------------
//
// The library is the same set of files the Library playlist holds -- in the
// capture it is one media library folder, `F:\Musica`, and every track sits
// under it. So the library-relative paths the real API returns are derivable
// from the captured `%path%` rather than invented: strip the root and flip the
// separators.
//
// Against the live player, paths come back `/`-separated even on
// Windows, where `pathSeparator` is `\`. A track under `F:\Musica` is
// `B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3`.

// The deepest directory every track shares, which is what foobar2000 would have
// been pointed at. Derived rather than hardcoded so a recapture from a
// differently-organised library still works.
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
		// file. A fixture that needs a non-zero subsong has to be captured, not
		// invented -- the whole point of `subsong` is that one file holds several
		// tracks, which cannot be faked by relabelling one.
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
	// The autoplaylist a user makes when Jean asks them to, and the only way to
	// see a library on a player without the media library API. Every index above
	// it is the one the reorder assertions were written against, and the one
	// below is hidden from the sidebar like this one is not.
	//
	// Note it sits beside an ordinary playlist called 'Library', which is the
	// point: Jean used to adopt anything loosely titled that as the user's whole
	// collection. The two together are what keeps that from coming back.
	{ id: "p8", title: "#Jean Library", isCurrent: false, items: allTracks() },
	// A *visible* autoplaylist, with an ordinary name, because that is what one
	// looks like from the API -- `#Jean Library` above is hidden from the sidebar
	// and from the add-to-playlist menu, so neither route to a refused write
	// could reach it. Appended rather than inserted so no index above it moves.
	{
		id: "p9",
		title: "Recently Added",
		isCurrent: false,
		isAuto: true,
		items: tracksOf("jar-of-flies").slice(0, 5),
	},
];

// An expression the player cannot resolve comes back as '?'; one that resolves
// to nothing comes back as ''. The difference is the whole capability-detection
// mechanism, so the fake has to reproduce it rather than return '' for both --
// a fixture that drops %lastfm_play_count% is an install without the playback
// statistics component, and the UI should hide the heat controls accordingly.
export const evaluate = (track: Track, expression: string) =>
	track[expression] ?? "?";

const columnsFor = (track: Track, expressions: string[]) =>
	expressions.map((expression) => evaluate(track, expression));

// The player pages the library by path and sorts a playlist by `%path%`, and
// the two agree: the endpoint's own default is file path, so `sort=%path%` and
// no sort at all return the same list. They only agree here
// if the separator does, because the library reports a relative `/`-joined path
// and the player reports an absolute Windows one. The root is common to every
// track, so it cancels; the separator does not.
const pathKey = (value: unknown) => String(value).replace(/\\/g, "/");

// How the media library hands a set back: album artist, album, track number.
// Not the path order the library endpoint pages in -- the two are different
// orders and the gap between them is a real bug's worth of wrong tracks.
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
	// How big the *media library* is -- the thing the 0.11 API serves and the
	// thing `#/all` is a view of. Separate from `librarySize`, which inflates an
	// ordinary playlist for the browsing specs. Set here it also replaces the
	// `#Jean Library` autoplaylist, so both sources still describe the same
	// library and a spec can assert the same behaviour through either.
	mediaLibrarySize,
	// The media library stated outright, for a spec about a library of a
	// particular shape. See `libraryOfShape`.
	mediaLibrary,
	// Expressions this player cannot resolve. Dropping them from the tracks makes
	// evaluate() answer '?', which is exactly what a real player does for a field
	// no component provides -- so `withoutFields: ['%lastfm_play_count%']` is an
	// install with no playback-statistics component, not a mock of one.
	withoutFields = [],
	// The media library, as beefweb 0.11+ exposes it. `supported: false` is
	// DeaDBeeF, where every library endpoint answers 501 -- which is how a client
	// is supposed to discover it has to fall back. `enabled: false` is
	// foobar2000 with no media library configured, a different state with a
	// different fix, and the two must not be collapsed.
	library = {},
	// Tag values the capture does not happen to carry, keyed by track title. One
	// person's library is not every library: this one has no featured artist and
	// no compilation on it, and neither is worth a sixth album of invented
	// fixture. Stating the tag a test needs keeps everything else captured.
	retagged = {},
	// The optional tag-writing component; see `fooJean.ts` for its states.
	fooJean = null,
	// Where a track's cover comes from when it is not one of the captured ones.
	// The capture matches a track to an album by path and answers with a file
	// name; a synthesised library has no file behind it, so the host that
	// synthesised it is the only thing that can say. Absent -- which is every
	// spec -- a track outside the capture has no cover, which is a real state
	// the UI has to draw anyway.
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

	// A player without the component that publishes these fields. It has to apply
	// to the *media library* as well as to playlists: the library API serves its
	// own copy of the tracks, so stripping only the playlists left the home
	// screen -- which reads the library -- still seeing play counts on an install
	// that was supposed to have none.
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

	// Inflates the ordinary playlist the browsing specs open, not the
	// autoplaylist search reads. The media library the API serves is the captured
	// one either way, so growing both would make the two sources disagree about
	// what the library is -- and the whole point of the seam is that they cannot.
	if (librarySize) {
		const library = playlists.find((entry) => entry.title === "Library");
		if (library) library.items = generateTracks(librarySize);
	}

	const listeners = new Set<(message: Changed) => void>();

	const state = {
		playlists,
		// Volume and playback order come off the real player; what is playing does
		// not, because the captured track is not in the fixture. Idle is also the
		// honest starting point for a test: nothing has happened yet.
		player: {
			...structuredClone(CAPTURED_PLAYER),
			playbackState: "stopped",
			activeItem: { ...IDLE_ITEM },
			...player,
		},
		// The track, not its position -- that is what foobar2000 holds, and both
		// measured behaviours fall out of looking the index up on read.
		playQueue: [] as { playlistId: string; track: Track }[],
		library: { supported: true, enabled: true, ...library },
		// Milliseconds to hold a write before answering. Zero by default, because
		// the fake is otherwise faster than a pointer can move -- which hides
		// exactly the behaviour that matters about a coalesced write. See
		// POST /__control/latency.
		latency: 0,
		// Every request the app made, in order. Lets a test assert what went over
		// the wire -- that a drag sent one items/copy and not forty, that a
		// coalesced write sent the last value rather than every value.
		requests: [] as RecordedRequest[],
		// Where each of the last few tracks began, in wall-clock milliseconds;
		// `fooJean.ts` puts them on the stream clock. Same bound as the
		// component's.
		streamMarks: [] as StreamMark[],
	};

	// beefweb pushes on change and never on a timer, so this deliberately has no
	// interval behind it. Position advances in the app's own interpolation; if
	// the fake ticked, tests would pass against behaviour the real player does
	// not have.
	const notify = (changed: Changed) => {
		const message: Changed = {};
		if (changed.player) message.player = true;
		if (changed.playlists) message.playlists = true;
		if (changed.playQueue) message.playQueue = true;
		for (const listener of listeners) listener(message);
	};

	const byId = (id: string) =>
		state.playlists.find((entry) => entry.id === id) ?? null;

	// Consumed, not merely consulted: a queued track leaves the queue when it
	// starts.
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
				// Where the player landed, which for a seek is the only thing that
				// makes the mark worth anything -- the track did not change.
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
		// Playing from a playlist makes it the current one, exactly as the player
		// does. The sidebar's "Playing from" marker depends on it.
		for (const entry of state.playlists) entry.isCurrent = entry === playlist;
		notify({ player: true, playlists: true, playQueue: dequeued });
	};

	const step = (delta: number) => {
		// The queue outranks both playback order and the playlist.
		const queued = delta > 0 ? state.playQueue[0] : null;
		if (queued) {
			const from = byId(queued.playlistId);
			const at = from?.items.indexOf(queued.track) ?? -1;
			if (from && at >= 0) {
				setActive(from, at, "playing");
				return;
			}
			// A queued track whose row has gone. The player skips it; so does this.
			state.playQueue.shift();
			notify({ playQueue: true });
		}

		const item = state.player.activeItem;
		const playlist = byId(item.playlistId);
		if (!playlist || item.index < 0) return;
		const next = item.index + delta;
		if (next < 0 || next >= playlist.items.length) return;
		setActive(playlist, next, "playing");
	};

	// An orphan's columns are deliberately still the removed track's: the real
	// player hands back whatever fell into the freed slot, so anything reading
	// columns rather than testing itemIndex has to be visibly wrong here too.
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
		// Named rather than spread: every mutation below works in place, so these
		// references stay live, but a spread would also have copied `playlists`
		// and quietly detached it the first time something reassigned the array.
		player: state.player,
		// On the facade rather than only on the inner state: the router reads it
		// before every write and the control surface assigns to it, and both were
		// reaching for this object. Behind the seam it was `undefined` until a test
		// set it -- falsy, so it worked, but only by accident.
		latency: state.latency,
		// What the player would report, rather than the track objects held inside.
		get playQueue() {
			return queuePayload();
		},
		requests: state.requests,
		// A getter for the same reason `playlists` is one: `mark` replaces the array
		// rather than pushing into it.
		get streamMarks() {
			return state.streamMarks;
		},
		library: state.library,
		fooJean: fooJeanState(fooJean),
		// Which `?format=` each stream was opened with, in order. `requests`
		// records paths without their query, and the whole codec fall-through is a
		// claim about the query string.
		streamFormats: [] as string[],
		// Separate objects from the playlists' whenever `withoutFields` is in play,
		// so a tag write has to reach both.
		libraryTracks,
		get playlists() {
			return state.playlists;
		},

		subscribe(listener: (message: Changed) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		record(method: string, path: string, body: RecordedRequest["body"]) {
			state.requests.push({ method, path, body });
		},

		playlistById: byId,

		// The six fields PlaylistInfo actually has -- no more, so that anything
		// reaching for an autoplaylist flag finds nothing here either.
		// totalTime is 0 because the real player returns 0, however long a playlist
		// actually runs. Copied rather than corrected.
		playlistsPayload: () =>
			state.playlists.map((entry, index) => ({
				id: entry.id,
				index,
				isCurrent: entry.isCurrent,
				itemCount: entry.items.length,
				title: entry.title,
				totalTime: 0,
			})),

		playerPayload(trcolumns: string[] = []) {
			const item = state.player.activeItem;
			const playlist = item.index >= 0 ? byId(item.playlistId) : null;
			const track = playlist?.items[item.index];
			return {
				...state.player,
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
			if (body.volume != null) state.player.volume.value = body.volume;
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

		// Item changes push `player` and NOT `playlists`. That is what beefweb
		// does -- checked against the live player by watching the stream while
		// mutating: an add, a rename and a delete each produced a `playlists`
		// message, while a copy of five items and a remove of two produced only
		// `player`. So `itemCount` in PlaylistInfo goes stale from the first write
		// onwards and anything that depends on it has to re-read it.
		//
		// The fake used to push `playlists` here, which quietly made the cache
		// self-healing and hid a bug that emptied the wrong number of rows out of
		// the search scratch playlist and then played whatever had drifted into
		// the position that was clicked.
		copyItems(sourceId: string, targetId: string, indices: number[]) {
			const source = byId(sourceId);
			const target = byId(targetId);
			if (!source || !target) return false;
			// Accepted and ignored, which is the whole trap: *measured* against
			// foobar2000 2.25.3, a copy into an autoplaylist answers 204 exactly as a
			// copy into an ordinary playlist does, and adds nothing. A fake that
			// returned 404 here would test a failure mode the player does not have.
			if (target.isAuto) return true;
			// Appended without a duplicate check, because the player appends without
			// one. Undo is what makes that safe, and undo is what the tests exercise.
			//
			// And in the *source's* order, not the caller's: a set arrives sorted
			// however it was asked for. `add-from-library` behaves the same way, so
			// this is a property of the player rather than of one endpoint.
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

		// The playlists push a real player sends only when the *set* of playlists
		// changes. A test that needs the app to re-read a playlist's contents --
		// which from the app's side is what a chunk of rows arriving looks like --
		// asks for it here, rather than having every copyItems pretend.
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

			// Default order is file path, per the spec. Sorting matters here because
			// the spec warns library items are "produced by applying search criteria
			// rather than naturally ordered", so a client paging without a sort is
			// relying on something it was told not to.
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

			// Byte-wise and case-sensitive, which is what the player does -- so
			// 'Zappa' sorts before 'abba'. Stated here because it looks like a bug.
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
			// Omitting `items` adds the whole library, per the spec.
			//
			// The live player ignores both the order asked for and the library's own
			// path order: a set arrives in the media library's **browse** order,
			// which is album artist, then album, then track number, and the larger
			// the set the more of it lands somewhere Jean did not put it.
			//
			// The fake sorted by path, which is a different thing that agrees often
			// enough to look right: it made every "play this set, starting here"
			// position correct here and wrong on a real player, for search, shelves
			// and All Music alike. Sorting the way the player actually does is what
			// makes `items/sort` load-bearing in the tests rather than decorative.
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

		// `{ by, desc, random }`. The expression is evaluated per track, exactly as
		// the column list is, so `%path%` sorts by path and nothing here needs to
		// know that is the order the library endpoint uses.
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

		// `queueIndex` is accepted and ignored, as foobar2000 does. Honouring it
		// would let an insert-at-position pass here and fail on the player.
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
