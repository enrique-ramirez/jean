import assert from "node:assert/strict";
import test from "node:test";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { genreIndex } from "../../src/domain/track/genres.ts";
import {
	columnCollector,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { rankEntities } from "../../src/domain/track/rankEntities.ts";
import { TIER } from "../../src/shared/lib/text.ts";

const LIBRARY: [genres: string[], artist: string, album: string][] = [
	[["Rock"], "Foo Fighters", "In Your Honor"],
	[["Rock"], "Foo Fighters", "The Colour and the Shape"],
	[["Rock", "Blues"], "Blood, Sweat & Tears", "Child Is Father to the Man"],
	[["Electronic"], "Daft Punk", "Discovery"],
	[["Electronic", "electronic"], "Daft Punk", "Discovery"],
	[["Folk, World, & Country"], "Mercedes Sosa", "Mujeres Argentinas"],
	[[""], "Untagged", "Field Recordings"],
];

const rows = LIBRARY.map(([genres, artist, album]) => {
	const row: string[] = [];
	row[FIELD.genre] = genres.join("\u001f");
	row[FIELD.artist] = artist;
	row[FIELD.album] = album;
	return row;
});

const columns = libraryColumnsOf(rows, TRACK_EXPRESSIONS.length);

const genres = genreIndex("library:1", columns);
const find = (name: string) => genres.find((entry) => entry.name === name);

test("a track tagged with several genres counts in each of them", () => {
	assert.equal(find("Rock")?.trackCount, 3);
	assert.equal(find("Blues")?.trackCount, 1);
	assert.equal(find("Blues")?.artistCount, 1);
});

test("a comma inside a value is part of the genre's name", () => {
	assert.equal(find("Folk, World, & Country")?.trackCount, 1);
	assert.equal(find("Folk"), undefined);
});

test("a genre the tag names twice counts the track once", () => {
	assert.equal(find("Electronic")?.trackCount, 2);
});

test("an untagged row is in no genre at all", () => {
	assert.deepEqual(genres.map((entry) => entry.name).sort(), [
		"Blues",
		"Electronic",
		"Folk, World, & Country",
		"Rock",
	]);
});

test("albums are counted per genre, and a record's tracks only once", () => {
	assert.equal(find("Electronic")?.albumCount, 1);
	assert.equal(find("Rock")?.albumCount, 3);
});

test("artists are counted per genre, and an artist's albums only once", () => {
	assert.equal(find("Rock")?.artistCount, 2);
	assert.equal(find("Electronic")?.artistCount, 1);
});

test("the index takes in rows that arrive after it was first asked for", () => {
	const key = "library:7";

	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	collector.add(rows.slice(0, 1));
	assert.equal(genreIndex(key, collector.table()).length, 1);

	collector.add(rows.slice(1));
	const grown = genreIndex(key, collector.table());
	assert.equal(grown.length, 4);
	assert.equal(grown.find((entry) => entry.name === "Rock")?.trackCount, 3);
	assert.equal(grown.find((entry) => entry.name === "Rock")?.artistCount, 2);
	assert.ok(grown.some((entry) => entry.name === "Electronic"));
});

const named = (query: string, floor: number = TIER.word) =>
	rankEntities(genres, query, floor).map((entry) => entry.name);

test("a name the query holds whole is offered; one it only contains is not", () => {
	assert.deepEqual(named("rock"), ["Rock"]);
	assert.deepEqual(named("blues"), ["Blues"]);
	assert.deepEqual(named("lectro"), []);
});

test("an empty query names nothing, whatever the floor", () => {
	assert.deepEqual(named("   ", TIER.typo), []);
});
