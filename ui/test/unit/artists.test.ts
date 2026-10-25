import assert from "node:assert/strict";
import test from "node:test";
import { artistsOf, refsOfArtist } from "../../src/domain/artist/artists.ts";
import {
	FIELD,
	namesAnArtist,
	TRACK_EXPRESSIONS,
} from "../../src/domain/track/fields.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";
import { trackRows } from "../../src/domain/track/project.ts";
import { rankEntities } from "../../src/domain/track/rankEntities.ts";
import { TIER } from "../../src/shared/lib/text.ts";

const LIBRARY: [artist: string, albumArtist: string, album: string][] = [
	["Foo Fighters", "Foo Fighters, Foo Fighters", "In Your Honor"],
	["Foo Fighters", "Foo Fighters, Foo Fighters", "The Colour and the Shape"],
	[
		"Blood, Sweat & Tears",
		"Blood, Sweat & Tears",
		"Child Is Father to the Man",
	],
	["TV On The Radio", "TV On The Radio, TV on the Radio", "Dear Science"],
	["Daft Punk feat. Todd Edwards", "Daft Punk", "Discovery"],
	["Disclosure feat. Sinead Harnett", "Disclosure", "Settle"],
	["Grover Washington, Jr.", "Grover Washington, Jr.", "Winelight"],
	["Simon & Garfunkel", "Simon & Garfunkel", "Bookends"],
	["Sleep With Sirens", "Sleep With Sirens", "Feel"],
	["Nobuo Uematsu", "Various Artists", "Final Fantasy"],
];

const rows = LIBRARY.map(([artist, albumArtist, album]) => {
	const row: string[] = [];
	row[FIELD.artist] = artist;
	row[FIELD.albumArtist] = albumArtist;
	row[FIELD.album] = album;
	return row;
});

const columnsOf = (of: string[][]) =>
	libraryColumnsOf(of, TRACK_EXPRESSIONS.length);

const columns = columnsOf(rows);

const artists = artistsOf(trackRows(columns), true);
const find = (name: string) =>
	artists.find((entry) => entry.key === name.toLowerCase());

test("a name written twice in one tag is one artist, not two", () => {
	assert.equal(find("foo fighters")?.trackCount, 2);
	assert.equal(find("foo fighters")?.albumCount, 2);
	assert.equal(artists.filter((a) => a.key.includes("foo fighters")).length, 1);
});

test("the two spellings of a doubled tag collapse together", () => {
	assert.equal(find("tv on the radio")?.trackCount, 1);
});

test("a comma inside a real name is not a separator", () => {
	assert.equal(find("blood, sweat & tears")?.trackCount, 1);
	assert.equal(find("grover washington, jr.")?.trackCount, 1);
});

test("neither is an ampersand, or the word 'with'", () => {
	assert.equal(find("simon & garfunkel")?.trackCount, 1);
	assert.equal(find("sleep with sirens")?.trackCount, 1);
	assert.equal(find("simon"), undefined);
	assert.equal(find("sirens"), undefined);
});

test("a featured guest is an artist of their own, credited as a guest", () => {
	assert.equal(find("sinead harnett")?.guestCount, 1);
	assert.equal(find("sinead harnett")?.trackCount, 0);
	assert.equal(find("disclosure")?.trackCount, 1);
	assert.equal(find("disclosure")?.guestCount, 0);
});

test("a lead credited in both tags counts its track once", () => {
	assert.equal(find("daft punk")?.trackCount, 1);
});

test("Various Artists is not an artist", () => {
	assert.equal(find("various artists"), undefined);
	assert.equal(find("nobuo uematsu")?.trackCount, 1);
});

test("a track is theirs when either tag names them, and a guest spot is not", () => {
	const daft = refsOfArtist(columns, "Daft Punk", true);
	assert.deepEqual([...daft.own], [4]);
	assert.deepEqual([...daft.guest], []);

	const harnett = refsOfArtist(columns, "Sinead Harnett", true);
	assert.deepEqual([...harnett.own], []);
	assert.deepEqual([...harnett.guest], [5]);
});

test("an empty name matches nothing rather than everything untagged", () => {
	const nothing = refsOfArtist(columns, "   ", true);
	assert.equal(nothing.own.length, 0);
	assert.equal(nothing.guest.length, 0);
});

test("the counts a page shows are the rows it draws", () => {
	for (const artist of artists) {
		const refs = refsOfArtist(columns, artist.name, true);
		const drawn = refs.own.length + refs.shared.length;
		assert.equal(
			drawn,
			artist.trackCount,
			`${artist.name}: index says ${artist.trackCount}, page draws ${drawn}`,
		);
		assert.equal(refs.guest.length, artist.guestCount, artist.name);
	}
});

const named = (query: string, floor: number = TIER.word) =>
	rankEntities(artists, query, floor).map((entry) => entry.name);

test("a name the query holds whole is offered; one it only contains is not", () => {
	assert.deepEqual(named("sirens"), ["Sleep With Sirens"]);
	assert.deepEqual(named("garfunkel"), ["Simon & Garfunkel"]);
	assert.deepEqual(named("unk"), []);
});

test("an exact name beats one that merely starts with the query", () => {
	assert.equal(named("foo fighters")[0], "Foo Fighters");
});

test("at the same rung, the artist you hold more of comes first", () => {
	const tied = artistsOf(
		trackRows(
			columnsOf(
				[
					["Blue Cat", "Blue Cat", "One"],
					["Blue Dog", "Blue Dog", "Two"],
					["Blue Dog", "Blue Dog", "Two"],
				].map(([artist, albumArtist, album]) => {
					const row: string[] = [];
					row[FIELD.artist] = artist;
					row[FIELD.albumArtist] = albumArtist;
					row[FIELD.album] = album;
					return row;
				}),
			),
		),
		true,
	);

	assert.deepEqual(
		rankEntities(tied, "blue", TIER.word).map((e) => e.name),
		["Blue Dog", "Blue Cat"],
	);
});

test("an empty query names nobody, whatever the floor", () => {
	assert.deepEqual(named("   ", TIER.typo), []);
});

test("Various Artists is nowhere you can go, wherever it is asked", () => {
	assert.equal(namesAnArtist("Various Artists"), false);
	assert.equal(namesAnArtist("  VA "), false);
	assert.equal(namesAnArtist(""), false);
	assert.equal(namesAnArtist(null), false);
	assert.equal(namesAnArtist("Blood, Sweat & Tears"), true);
});

const SEPARATOR = String.fromCharCode(31);

interface Credit {
	artist: string;
	albumArtist?: string;
	album?: string;
	artists?: string[];
	artistIds?: string[];
	albumArtistIds?: string[];
}

const creditedColumns = (credits: Credit[]) =>
	columnsOf(
		credits.map((credit) => {
			const row: string[] = [];
			row[FIELD.artist] = credit.artist;
			row[FIELD.albumArtist] = credit.albumArtist ?? credit.artist;
			row[FIELD.album] = credit.album ?? credit.artist;
			row[FIELD.artists] = (credit.artists ?? []).join(SEPARATOR);
			row[FIELD.artistIds] = (credit.artistIds ?? []).join(SEPARATOR);
			row[FIELD.albumArtistIds] = (credit.albumArtistIds ?? []).join(SEPARATOR);
			return row;
		}),
	);

const REVELRIES = "id-revelries";
const PURNELL = "id-purnell";

test("MusicBrainz ids put a collaboration on each artist's page, as shared", () => {
	const library = creditedColumns([
		{ artist: "Revelries", album: "Descanso Gardens", artistIds: [REVELRIES] },
		{
			artist: "Revelries & Henri Purnell",
			album: "Feel It Still",
			artistIds: [REVELRIES, PURNELL],
			albumArtistIds: [REVELRIES, PURNELL],
		},
	]);

	for (const guesses of [true, false]) {
		const revelries = refsOfArtist(library, "Revelries", guesses);
		assert.deepEqual([...revelries.own], [0]);
		assert.deepEqual([...revelries.shared], [1]);

		const purnell = refsOfArtist(library, "Henri Purnell", guesses);
		assert.deepEqual([...purnell.shared], [1]);
	}

	const index = artistsOf(trackRows(library), false);
	const named = (name: string) =>
		index.find((entry) => entry.key === name.toLowerCase());
	assert.equal(named("revelries")?.trackCount, 2);
	assert.equal(named("henri purnell")?.trackCount, 1);
	assert.equal(named("revelries & henri purnell")?.trackCount, 1);
});

test("an id names the artist by the spelling a solo track gives it", () => {
	const library = creditedColumns([
		{ artist: "Revelries", artistIds: [REVELRIES] },
		{ artist: "REVELRIES, Henri Purnell", artistIds: [REVELRIES, PURNELL] },
	]);
	assert.deepEqual([...refsOfArtist(library, "Revelries", false).shared], [1]);
});

test("one id is one artist, whatever its name holds", () => {
	const library = creditedColumns([
		{ artist: "Simon", artistIds: ["id-simon"] },
		{ artist: "Simon & Garfunkel", artistIds: ["id-duo"] },
	]);
	assert.deepEqual([...refsOfArtist(library, "Simon", true).shared], []);
});

test("ids that do not match the credit's parts keep only the names the library knows", () => {
	const library = creditedColumns([
		{ artist: "Revelries", artistIds: [REVELRIES] },
		{
			artist: "Revelries and Friends",
			artistIds: [REVELRIES, "id-unknown"],
		},
	]);
	assert.deepEqual([...refsOfArtist(library, "Revelries", false).shared], [1]);
	assert.deepEqual([...refsOfArtist(library, "Friends", false).shared], []);
});

test("ARTISTS names each artist directly, and a name after feat. stays a guest", () => {
	const library = creditedColumns([
		{
			artist: "Yung Dupe x LIL COOKIE feat. Kimmø",
			artists: ["Yung Dupe", "LIL COOKIE", "Kimmø"],
		},
	]);
	assert.deepEqual([...refsOfArtist(library, "LIL COOKIE", false).shared], [0]);
	assert.deepEqual([...refsOfArtist(library, "Kimmø", false).guest], [0]);
});

test("without tags, a part is credited only where the library names it alone, and only while guessing", () => {
	const library = creditedColumns([
		{ artist: "Revelries" },
		{ artist: "Revelries & Henri Purnell" },
	]);
	assert.deepEqual([...refsOfArtist(library, "Revelries", true).shared], [1]);
	assert.deepEqual(
		[...refsOfArtist(library, "Henri Purnell", true).shared],
		[],
	);
	assert.deepEqual([...refsOfArtist(library, "Revelries", false).shared], []);
});

test("a record whose album artist is the artist alone is their own, even with a partner on the track", () => {
	const library = creditedColumns([
		{
			artist: "Revelries & STVNS",
			albumArtist: "Revelries",
			artistIds: [REVELRIES, "id-stvns"],
			albumArtistIds: [REVELRIES],
		},
	]);
	const revelries = refsOfArtist(library, "Revelries", false);
	assert.deepEqual([...revelries.own], [0]);
	assert.deepEqual([...revelries.shared], []);
});

test("with guessing off, an untagged library is credited exactly as before", () => {
	const library = creditedColumns([
		{ artist: "Revelries" },
		{ artist: "Revelries & Henri Purnell" },
	]);
	const index = artistsOf(trackRows(library), false);
	assert.deepEqual(
		index.map((entry) => [entry.name, entry.trackCount]),
		[
			["Revelries", 1],
			["Revelries & Henri Purnell", 1],
		],
	);
});
