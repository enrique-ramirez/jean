import assert from "node:assert/strict";
import test from "node:test";

import {
	DETAIL_EXPRESSIONS,
	DETAIL_FIELD,
	rowWith,
} from "../../src/domain/track/detailFields.ts";

type Column = keyof typeof DETAIL_FIELD;

const SEPARATOR = String.fromCharCode(31);

// Every column holds a value of its own, so a write that lands on the wrong one shows.
const hosted = () => DETAIL_EXPRESSIONS.map((_, at) => `held ${at}`);

const changed = (columns: Partial<Record<Column, string>>) => {
	const row = hosted();
	for (const [column, value] of Object.entries(columns))
		row[DETAIL_FIELD[column as Column]] = value as string;
	return row;
};

test("a single-value field is written to its drawn column and its raw column alike", () => {
	assert.deepEqual(
		rowWith(hosted(), { ALBUM: "Bookends" }),
		changed({ album: "Bookends", albumRaw: "Bookends" }),
	);
});

test("a multi-value field is drawn joined as the player joins it, and held raw separator-joined", () => {
	assert.deepEqual(
		rowWith(hosted(), { ARTIST: ["Simon", "Garfunkel"] }),
		changed({
			artist: "Simon, Garfunkel",
			artistRaw: `Simon${SEPARATOR}Garfunkel`,
		}),
	);
	assert.deepEqual(
		rowWith(hosted(), { COMPOSER: "Paul Simon" }),
		changed({ composer: "Paul Simon", composerRaw: "Paul Simon" }),
	);
});

// The genre column is read with `$meta_sep` on the separator, so its drawn form keeps it too.
test("GENRE's drawn column keeps the separator its expression answers with", () => {
	assert.deepEqual(
		rowWith(hosted(), { GENRE: ["Folk", "Pop"] }),
		changed({
			genre: `Folk${SEPARATOR}Pop`,
			genreRaw: `Folk${SEPARATOR}Pop`,
		}),
	);
});

test("a removed tag empties both the column it is drawn from and its raw column", () => {
	assert.deepEqual(
		rowWith(hosted(), { "ALBUM ARTIST": "", BPM: "" }),
		changed({ albumArtist: "", albumArtistRaw: "", bpm: "", bpmRaw: "" }),
	);
});

test("a field the view draws from no column of its own changes only its raw column", () => {
	assert.deepEqual(
		rowWith(hosted(), { TITLE: "Cecilia" }),
		changed({ titleRaw: "Cecilia" }),
	);
});

test("YEAR follows a written DATE, and is emptied with it", () => {
	assert.deepEqual(
		rowWith(hosted(), { DATE: "1970-01-26" }),
		changed({ date: "1970-01-26", dateRaw: "1970-01-26", year: "1970" }),
	);
	assert.deepEqual(
		rowWith(hosted(), { DATE: "" }),
		changed({ date: "", dateRaw: "", year: "" }),
	);
});

test("columns no written field reaches are left as they were, in the row given as well", () => {
	const given = hosted();
	assert.deepEqual(rowWith(given, {}), hosted());
	assert.deepEqual(
		rowWith(given, { TRACKNUMBER: "3", MOOD: "calm" }),
		changed({ trackNumber: "3", trackNumberRaw: "3" }),
	);
	assert.deepEqual(given, hosted());
});
