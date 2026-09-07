import assert from "node:assert/strict";
import test from "node:test";
import {
	artistIndex,
	artistsOf,
	namesAnArtist,
	rankArtists,
	refsOfArtist,
} from "../../src/domain/track/artists.ts";
import { FIELD } from "../../src/domain/track/fields.ts";
import { TIER } from "../../src/shared/lib/text.ts";

// Tagging shapes taken off a real library, including the two that pull in opposite directions: a
// name written twice, and a name with a comma in it.
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

const artists = artistsOf(rows);
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
	// The composer on that compilation still is.
	assert.equal(find("nobuo uematsu")?.trackCount, 1);
});

test("a track is theirs when either tag names them, and a guest spot is not", () => {
	const daft = refsOfArtist(rows, "Daft Punk");
	assert.deepEqual([...daft.own], [4]);
	assert.deepEqual([...daft.guest], []);

	const harnett = refsOfArtist(rows, "Sinead Harnett");
	assert.deepEqual([...harnett.own], []);
	assert.deepEqual([...harnett.guest], [5]);
});

test("an empty name matches nothing rather than everything untagged", () => {
	const nothing = refsOfArtist(rows, "   ");
	assert.equal(nothing.own.length, 0);
	assert.equal(nothing.guest.length, 0);
});

test("the counts a page shows are the rows it draws", () => {
	for (const artist of artists) {
		const refs = refsOfArtist(rows, artist.name);
		assert.equal(
			refs.own.length,
			artist.trackCount,
			`${artist.name}: index says ${artist.trackCount}, page draws ${refs.own.length}`,
		);
		assert.equal(refs.guest.length, artist.guestCount, artist.name);
	}
});

// The library arrives a chunk at a time under a key that never changes, since the key carries the
// total the player reported rather than what has landed. An index that reads the key alone answers
// from the first chunk for the rest of the session.
test("the index takes in rows that arrive after it was first asked for", () => {
	const key = "library:10";

	assert.equal(artistIndex(key, rows.slice(0, 2)).length, 1);
	assert.equal(artistIndex(key, rows.slice(0, 2))[0].name, "Foo Fighters");

	const grown = artistIndex(key, rows);
	assert.ok(grown.length > 1, "the rest of the library reached the index");
	assert.ok(grown.some((entry) => entry.key === "sinead harnett"));

	// And the counts are the whole library's, not the first chunk's plus a second pass over it.
	assert.equal(
		grown.find((entry) => entry.key === "foo fighters")?.trackCount,
		2,
	);
});

test("a different library is built afresh rather than added to", () => {
	artistIndex("library:10", rows);
	const other = artistIndex("library:1", rows.slice(2, 3));
	assert.equal(other.length, 1);
	assert.equal(other[0].key, "blood, sweat & tears");
});

// What the dropdown offers as a section: the whole-word floor, best first.
const named = (query: string, floor = TIER.word) =>
	rankArtists(artists, query, floor).map((entry) => entry.name);

test("a name the query holds whole is offered; one it only contains is not", () => {
	assert.deepEqual(named("sirens"), ["Sleep With Sirens"]);
	// `Garfunkel` is a whole word of the name, so it stands.
	assert.deepEqual(named("garfunkel"), ["Simon & Garfunkel"]);
	// `unk` is inside `Daft Punk` and inside nothing whole, so the section stays shut.
	assert.deepEqual(named("unk"), []);
});

test("an exact name beats one that merely starts with the query", () => {
	assert.equal(named("foo fighters")[0], "Foo Fighters");
});

test("at the same rung, the artist you hold more of comes first", () => {
	// Two names of the same length matching the same way, so nothing but the library separates them.
	const tied = artistsOf(
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
	);

	assert.deepEqual(
		rankArtists(tied, "blue", TIER.word).map((e) => e.name),
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
