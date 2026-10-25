import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	createState,
	type FakePlaylist,
	GENERATION_SEED,
	guidOfDefault,
	type Track,
} from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	declared,
	type FakeState,
	withFake,
} from "./fakeLibraryHarness.ts";

const inLibrary = (path: string, fields: Track): Track => ({
	"%path%": `C:\\Music\\Lib\\${path}`,
	...fields,
});

const outside = (name: string, fields: Track): Track => ({
	"%path%": `D:\\Elsewhere\\${name}.flac`,
	...fields,
});

// Ordinals follow the paths: A\1 is 0, A\2 is 1, and so on to E\2 at 7. North by Ana's first
// track by number is A\2, so its cover is not the first of its rows by ordinal.
export const libraryTracks = () => {
	const north = (path: string, track: string, plays: string) =>
		inLibrary(path, {
			"%title%": `North ${track}`,
			"%album%": "North",
			"%artist%": "Ana",
			"%tracknumber%": track,
			"%year%": "2001",
			"%length_seconds%": "200",
			"%lastfm_play_count%": plays,
		});
	return {
		a1: north("A\\1.flac", "3", "5"),
		a2: north("A\\2.flac", "1", "9"),
		a3: north("A\\3.flac", "2", "2"),
		b1: inLibrary("B\\1.flac", {
			"%title%": "South 1",
			"%album%": "South",
			"%artist%": "Bea",
			"%tracknumber%": "1",
			"%year%": "1999",
			"%length_seconds%": "100",
			"%lastfm_play_count%": "1",
		}),
		b2: inLibrary("B\\2.flac", {
			"%title%": "South 2",
			"%album%": "South",
			"%artist%": "Bea",
			"%tracknumber%": "2",
			"%year%": "1999",
			"%length_seconds%": "100",
			"%lastfm_play_count%": "3",
		}),
		c1: inLibrary("C\\1.flac", {
			"%title%": "North by Cal",
			"%album%": "North",
			"%artist%": "Cal",
			"%tracknumber%": "1",
			"%year%": "2010",
			"%length_seconds%": "60",
			"%lastfm_play_count%": "0",
		}),
		e1: inLibrary("E\\1.flac", {
			"%title%": "Blank 1",
			"%album%": "Blank",
			"%artist%": "   ",
			"%tracknumber%": "1",
			"%length_seconds%": "10",
			"%lastfm_play_count%": "0",
		}),
		e2: inLibrary("E\\2.flac", {
			"%title%": "Blank 2",
			"%album%": "Blank",
			"%tracknumber%": "2",
			"%length_seconds%": "10",
			"%lastfm_play_count%": "0",
		}),
	};
};

export const LIBRARY_ORDINAL = {
	a1: 0,
	a2: 1,
	a3: 2,
	b1: 3,
	b2: 4,
	c1: 5,
	e1: 6,
	e2: 7,
} as const;

export const outsideTracks = () => ({
	x1: outside("North", {
		"%title%": "North from elsewhere",
		"%album%": "North",
		"%artist%": "Ana",
		"%tracknumber%": "4",
		"%year%": "2015",
		"%length_seconds%": "50",
		"%lastfm_play_count%": "4",
	}),
	x2: outside("Loose 1", {
		"%title%": "Loose 1",
		"%artist%": "Dee",
		"%length_seconds%": "30",
		"%lastfm_play_count%": "20",
	}),
	x3: outside("Loose 2", {
		"%title%": "Loose 2",
		"%artist%": "Dee",
		"%length_seconds%": "30",
		"%lastfm_play_count%": "0",
	}),
	x4: outside("Loose 3", {
		"%title%": "Loose 3",
		"%artist%": "Eve",
		"%length_seconds%": "30",
		"%lastfm_play_count%": "0",
	}),
});

export const playlistOf = (n: number, items: Track[]): FakePlaylist => ({
	id: `p${n}`,
	guid: guidOfDefault(n),
	title: `Mixed ${n}`,
	isCurrent: n === 1,
	structure: GENERATION_SEED,
	revision: GENERATION_SEED,
	changeHistory: [{ revision: GENERATION_SEED, positions: [] }],
	items,
});

export const MIXED = guidOfDefault(1);
export const EMPTY = guidOfDefault(2);
export const YEARLESS = guidOfDefault(3);
export const UNKNOWN_PLAYLIST = guidOfDefault(999);

// The mixed playlist, by position:
//  0 b2   South, Bea
//  1 a1   North, Ana
//  2 a3   North, Ana
//  3 x1   North, Ana, outside
//  4 c1   North, Cal
//  5 x2   untagged, Dee, outside
//  6 x3   untagged, Dee, outside
//  7 x4   untagged, Eve, outside
//  8 e1   Blank, a credit of whitespace
//  9 e2   Blank, no credit
// 10 b1   South, Bea
// 11 a2   North, Ana
export const mixedState = (
	fooJean: object = {},
	{ build = true }: { build?: boolean } = {},
): FakeState => {
	const held = libraryTracks();
	const away = outsideTracks();
	const playlists = [
		playlistOf(1, [
			held.b2,
			held.a1,
			held.a3,
			away.x1,
			held.c1,
			away.x2,
			away.x3,
			away.x4,
			held.e1,
			held.e2,
			held.b1,
			held.a2,
		]),
		playlistOf(2, []),
		playlistOf(3, [held.e1, held.e2, away.x2]),
	];
	const options = {
		mediaLibrary: Object.values(held),
		playlists,
		...withFake(fooJean),
	};
	return build
		? declared(options, [...TRACK_EXPRESSIONS])
		: createState(options);
};

export const structureOf = async (state: FakeState, guid: string) =>
	bodyOf(
		await ask(state, `/api/playlists/${guid}/items`, {
			query: [
				["offset", "0"],
				["count", "0"],
				["columns", "%title%"],
			],
		}),
	).structure as string;
