import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";
import { searchLibrary } from "../../src/domain/track/libraryIndex.ts";
import {
	type SearchIndex,
	searchIndex,
} from "../../src/domain/track/searchText.ts";

const LIBRARY: [title: string, artist: string][] = [
	["Árbol", "Babasónicos"],
	["Arena", "Babasónicos"],
	["Arenal", "Brand New"],
	["Barco", "Alice in Chains"],
	["Carta", "Brand New"],
	["Deléctrico", "Babasónicos"],
	["Nutshell", "Alice in Chains"],
	["Rotten Apple", "Alice in Chains"],
];

const columns = libraryColumnsOf(
	LIBRARY.map(([title, artist]) => {
		const row: string[] = [];
		row[FIELD.title] = title;
		row[FIELD.artist] = artist;
		return row;
	}),
	TRACK_EXPRESSIONS.length,
);

const EVERY_ROW = LIBRARY.map((_, ref) => ref);

// An index that remembers which rows a search read, since narrowing changes how many rows are
// read and never which ones are found.
const watched = () => {
	const index = searchIndex(columns);
	const read = new Set<number>();

	const watching: SearchIndex = {
		fields: index.fields.map((field) => ({
			...field,
			text: (ref) => {
				read.add(ref);
				return field.text(ref);
			},
		})),
		title: index.title,
	};

	return {
		search: (query: string, trackCount = LIBRARY.length) => {
			read.clear();
			const found = searchLibrary(watching, trackCount, query);
			return { found: [...(found ?? [])], read: [...read].sort() };
		},
	};
};

const fromScratch = (query: string) => [
	...(searchLibrary(searchIndex(columns), LIBRARY.length, query) ?? []),
];

test("the first search reads every row", () => {
	assert.deepEqual(watched().search("ar").read, EVERY_ROW);
});

test("a draft that extends the last one reads only the rows the last one found", () => {
	const { search } = watched();

	const first = search("ar");
	const longer = search("are");

	assert.deepEqual(longer.read, first.found);
	assert.deepEqual(longer.found, fromScratch("are"));
	assert.notDeepEqual(longer.found, first.found);
});

test("a second word narrows the first", () => {
	const { search } = watched();

	const first = search("ar");
	const two = search("ar baba");

	assert.deepEqual(two.read, first.found);
	assert.deepEqual(two.found, fromScratch("ar baba"));
});

test("a word typed ahead of the last one still narrows it", () => {
	const { search } = watched();

	const first = search("arena");
	const two = search("brand arena");

	assert.deepEqual(two.read, first.found);
	assert.deepEqual(two.found, fromScratch("brand arena"));
});

test("a draft that loses a letter is searched from scratch, and finds the rows the longer one dropped", () => {
	const { search } = watched();

	search("ar");
	const longer = search("aren");
	const shorter = search("are");

	assert.deepEqual(shorter.read, EVERY_ROW);
	assert.deepEqual(shorter.found, fromScratch("are"));
	assert.ok(shorter.found.length >= longer.found.length);
});

test("a draft that turns into another word is searched from scratch", () => {
	const { search } = watched();

	search("arena");
	const other = search("nut");

	assert.deepEqual(other.read, EVERY_ROW);
	assert.deepEqual(other.found, fromScratch("nut"));
});

test("one word split into two is searched from scratch, since each half matches more", () => {
	const { search } = watched();

	search("barco");
	const split = search("bar co");

	assert.deepEqual(split.read, EVERY_ROW);
	assert.deepEqual(split.found, fromScratch("bar co"));
});

test("a library that grew since the last search is searched whole", () => {
	const { search } = watched();

	const partial = search("ar", 3);
	assert.deepEqual(partial.read, [0, 1, 2]);

	const whole = search("are");
	assert.deepEqual(whole.read, EVERY_ROW);
	assert.deepEqual(whole.found, fromScratch("are"));
});

test("an empty draft matches nothing and forgets nothing", () => {
	const { search } = watched();

	const first = search("ar");
	assert.deepEqual(search("  "), { found: [], read: [] });
	assert.deepEqual(search("are").read, first.found);
});
