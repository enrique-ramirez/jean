import {
	type FakePlaylist,
	guidOfDefault,
	type Track,
} from "../test/fake-api/state.ts";

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

const DATE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const FIELD = "%lastfm_last_played%";
const HOURS_BEHIND_NOW = 3;

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

	const shift = Date.now() - HOURS_BEHIND_NOW * 60 * 60 * 1000 - newest;
	if (shift <= 0) return;

	for (const track of tracks) {
		const at = parse(track[FIELD]);
		if (at) track[FIELD] = format(new Date(at.getTime() + shift));
	}
};

export interface DemoLibrary {
	tracks: Track[];
	playlists: FakePlaylist[];
	artworkOf: (track: Track) => string | null;
}

// The ids are not contiguous and not in index order, as on a real install.
const playlistsOf = (byAlbum: Map<string, CapturedAlbum>): FakePlaylist[] => {
	const of = (...slugs: string[]) =>
		slugs.flatMap((slug) => byAlbum.get(slug)?.tracks ?? []);

	return [
		{
			id: "p1",
			guid: guidOfDefault(1),
			title: "Default Playlist",
			isCurrent: false,
			structure: 0,
			revision: 0,
			changeHistory: [{ revision: 0, positions: [] }],
			items: of("nirvana-nevermind").slice(0, 6),
		},
		{
			id: "p7",
			guid: guidOfDefault(7),
			title: "Library",
			isCurrent: true,
			structure: 0,
			revision: 0,
			changeHistory: [{ revision: 0, positions: [] }],
			items: of(
				"radiohead-ok-computer",
				"the-strokes-is-this-it",
				"daft-punk-discovery",
			),
		},
		{
			id: "p2",
			guid: guidOfDefault(2),
			title: "Favorites",
			isCurrent: false,
			structure: 0,
			revision: 0,
			changeHistory: [{ revision: 0, positions: [] }],
			items: [
				...of("brand-new-deja-entendu").slice(0, 4),
				...of("queen-a-night-at-the-opera").slice(0, 3),
				...of("bad-bunny-un-verano-sin-ti").slice(0, 3),
				...of("the-beatles-abbey-road").slice(0, 2),
			],
		},
		{
			id: "p5",
			guid: guidOfDefault(5),
			title: "Loud",
			isCurrent: false,
			structure: 0,
			revision: 0,
			changeHistory: [{ revision: 0, positions: [] }],
			items: of("metallica-metallica", "korn-issues"),
		},
		// An autoplaylist looks ordinary from the API, except that writes to it are
		// accepted and ignored.
		{
			id: "p9",
			guid: guidOfDefault(9),
			title: "Recently Added",
			isCurrent: false,
			isAuto: true,
			structure: 0,
			revision: 0,
			changeHistory: [{ revision: 0, positions: [] }],
			items: of("bad-bunny-yhlqmdlg").slice(0, 8),
		},
	];
};

export function demoLibrary(captured: CapturedLibrary): DemoLibrary {
	const tracks = captured.albums.flatMap((album) => album.tracks);
	slideForward(tracks);

	const byAlbum = new Map(captured.albums.map((album) => [album.slug, album]));

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
