import assert from "node:assert/strict";
import test from "node:test";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { genreIndex, genresOf } from "../../src/domain/track/genres.ts";
import {
	columnCollector,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { trackRows } from "../../src/domain/track/project.ts";
import { rankEntities } from "../../src/domain/track/rankEntities.ts";
import { TIER } from "../../src/shared/lib/text.ts";

const LIBRARY: [genre: string, artist: string, album: string][] = [
	["Rock", "Foo Fighters", "In Your Honor"],
	["Rock", "Foo Fighters", "The Colour and the Shape"],
	["Rock; Blues", "Blood, Sweat & Tears", "Child Is Father to the Man"],
	["Electronic", "Daft Punk", "Discovery"],
	["Electronic", "Daft Punk", "Discovery"],
	["", "Untagged", "Field Recordings"],
];

const rows = LIBRARY.map(([genre, artist, album]) => {
	const row: string[] = [];
	row[FIELD.genre] = genre;
	row[FIELD.artist] = artist;
	row[FIELD.album] = album;
	return row;
});

const columns = libraryColumnsOf(rows, TRACK_EXPRESSIONS.length);

const genres = genresOf(trackRows(columns));
const find = (name: string) => genres.find((entry) => entry.name === name);

test("a joined tag is one genre, not the genres inside it", () => {
	assert.equal(find("Rock")?.trackCount, 2);
	assert.equal(find("Rock; Blues")?.trackCount, 1);
	assert.equal(find("Blues"), undefined);
});

test("an untagged row is in no genre at all", () => {
	assert.equal(genres.length, 3);
	assert.equal(find(""), undefined);
});

test("albums are counted per genre, and a record's tracks only once", () => {
	assert.equal(find("Electronic")?.trackCount, 2);
	assert.equal(find("Electronic")?.albumCount, 1);
	assert.equal(find("Rock")?.albumCount, 2);
});

test("artists are counted per genre, and an artist's albums only once", () => {
	assert.equal(find("Rock")?.artistCount, 1);
	assert.equal(find("Electronic")?.artistCount, 1);
	assert.equal(find("Rock; Blues")?.artistCount, 1);
});

// `growingIndex`'s own comment has why a key on its own is not enough; this is that trap against a
// tag foobar has joined.
test("the index takes in rows that arrive after it was first asked for", () => {
	const key = "library:6";

	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	collector.add(rows.slice(0, 1));
	assert.equal(genreIndex(key, collector.table()).length, 1);

	collector.add(rows.slice(1));
	const grown = genreIndex(key, collector.table());
	assert.equal(grown.length, 3);
	assert.equal(grown.find((entry) => entry.name === "Rock")?.trackCount, 2);
	assert.equal(grown.find((entry) => entry.name === "Rock")?.artistCount, 1);
	assert.ok(grown.some((entry) => entry.name === "Electronic"));
});

const named = (query: string, floor: number = TIER.word) =>
	rankEntities(genres, query, floor).map((entry) => entry.name);

test("a name the query holds whole is offered; one it only contains is not", () => {
	assert.deepEqual(named("rock"), ["Rock", "Rock; Blues"]);
	assert.deepEqual(named("blues"), ["Rock; Blues"]);
	assert.deepEqual(named("lectro"), []);
});

test("an empty query names nothing, whatever the floor", () => {
	assert.deepEqual(named("   ", TIER.typo), []);
});
