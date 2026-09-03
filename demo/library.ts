import type { FakePlaylist, Track } from "../test/fake-api/state.ts";

// The library the demo browses: a hundred and fifty-two real albums, captured
// off a real foobar2000 by `test/fake-api/capture.ts --albums demo/albums.ts`.
// Which records, and why those, is in `albums.ts`.
//
// **Nothing here is synthesised any more, and that is the point.** It used to
// be five captured albums plus two hundred invented ones with drawn covers,
// which demonstrated the app on a library nobody has: the play counts came out
// of a random number generator, so the home screen's shelves were a picture of
// that generator, and the genre bars were a picture of a word list. Now the
// counts, the last-played dates, the lyrics, the ratings, the two- and
// three-disc sets and the four codecs are one person's actual collection, and
// every shelf on the front door is a true statement about it.
//
// The file is *fetched* rather than bundled: it is 1.9 MB of JSON, the service
// worker is revalidated on every visit, and a worker carrying the whole library
// would be re-downloaded whenever anything else in it changed.

export interface CapturedAlbum {
	albumArtist: string;
	album: string;
	slug: string;
	artwork: string | null;
	tracks: Track[];
}

export interface CapturedLibrary {
	capturedFrom: string;
	albums: CapturedAlbum[];
}

const albumKey = (track: Track) =>
	`${track["%album artist%"]} ${track["%album%"]}`;

// ---- recency ---------------------------------------------------------------

// Half of what the home screen draws is *when*: a shelf of what you have been
// playing lately, and a shading that fades a row by how long it has been. A
// capture is a photograph of one afternoon, so a demo still serving it a year
// later says "last played: a year ago" about everything, and the shelves
// quietly stop meaning anything.
//
// So the whole capture is slid forward once, on load. Relative distances are
// untouched -- what was played that morning is still hours ahead of what was
// played the spring before -- and no date is invented: the newest one in the
// file becomes today, and the rest follow it.
const DATE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const FIELD = "%lastfm_last_played%";

const parse = (value: string | undefined) => {
	const parts = DATE.exec(value ?? "");
	if (!parts) return null;
	const [, year, month, day, hour, minute, second] = parts;
	return new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	);
};

const format = (at: Date) => {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
	);
};

const slideForward = (tracks: Track[]) => {
	let newest = 0;
	for (const track of tracks) {
		const at = parse(track[FIELD]);
		if (at) newest = Math.max(newest, at.getTime());
	}
	if (newest === 0) return;

	// A few hours short of now, so the most-played record was played this
	// morning rather than this second -- which is what a real one looks like.
	const shift = Date.now() - 3 * 60 * 60 * 1000 - newest;
	if (shift <= 0) return;

	for (const track of tracks) {
		const at = parse(track[FIELD]);
		if (at) track[FIELD] = format(new Date(at.getTime() + shift));
	}
};

// ---- the library -----------------------------------------------------------

export interface DemoLibrary {
	tracks: Track[];
	playlists: FakePlaylist[];
	artworkOf: (track: Track) => string | null;
}

// Playlists somebody would actually have, drawn from what was captured. The
// names are ordinary on purpose, and one of them is `Library`: Jean used to
// adopt anything loosely called that as the whole collection, and an ordinary
// playlist with that name sitting beside the real one is what keeps that from
// coming back -- the same reason the test fixture has one.
//
// The ids are `p1 p7 p2 p5`, not contiguous and not in index order, because
// that is what a real install looks like.
const playlistsOf = (byAlbum: Map<string, CapturedAlbum>): FakePlaylist[] => {
	const of = (...slugs: string[]) =>
		slugs.flatMap((slug) => byAlbum.get(slug)?.tracks ?? []);

	return [
		{
			id: "p1",
			title: "Default Playlist",
			isCurrent: false,
			items: of("nirvana-nevermind").slice(0, 6),
		},
		{
			id: "p7",
			title: "Library",
			isCurrent: true,
			items: of(
				"radiohead-ok-computer",
				"the-strokes-is-this-it",
				"daft-punk-discovery",
			),
		},
		{
			id: "p2",
			title: "Favorites",
			isCurrent: false,
			items: [
				...of("brand-new-deja-entendu").slice(0, 4),
				...of("queen-a-night-at-the-opera").slice(0, 3),
				...of("bad-bunny-un-verano-sin-ti").slice(0, 3),
				...of("the-beatles-abbey-road").slice(0, 2),
			],
		},
		{
			id: "p5",
			title: "Loud",
			isCurrent: false,
			items: of("metallica-metallica", "korn-issues"),
		},
		// Jean's own, hidden from the sidebar, and what the library resolves to on
		// a player with no media library API. `mediaLibrary` fills it.
		{ id: "p8", title: "#Jean Library", isCurrent: false, items: [] },
		// An autoplaylist with an ordinary name, which is what one looks like from
		// the API: writes to it are accepted and ignored.
		{
			id: "p9",
			title: "Recently Added",
			isCurrent: false,
			isAuto: true,
			items: of("bad-bunny-yhlqmdlg").slice(0, 8),
		},
	];
};

export function demoLibrary(captured: CapturedLibrary): DemoLibrary {
	const tracks = captured.albums.flatMap((album) => album.tracks);
	slideForward(tracks);

	const byAlbum = new Map(captured.albums.map((album) => [album.slug, album]));

	// Keyed by album rather than by track: twelve rows of one record share a
	// cover, so they share the file name the worker is asked for.
	const covers = new Map<string, string>();
	for (const album of captured.albums) {
		const first = album.tracks[0];
		if (album.artwork && first) covers.set(albumKey(first), album.artwork);
	}

	return {
		tracks,
		playlists: playlistsOf(byAlbum),
		artworkOf: (track) => covers.get(albumKey(track)) ?? null,
	};
}
