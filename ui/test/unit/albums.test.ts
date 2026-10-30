import assert from "node:assert/strict";
import test from "node:test";
import {
	artistGroups,
	FIELD,
	TRACK_EXPRESSIONS,
	tagGroups,
} from "../../src/domain/track/fields.ts";
import { albumOfRoute, albumRoute } from "../../src/domain/track/routes.ts";
import { columnCollector, libraryColumnsOf } from "./libraryTable.ts";

const LIBRARY: [artist: string, albumArtist: string, album: string][] = [
	["Blood, Sweat & Tears", "Blood, Sweat & Tears", "Blood, Sweat & Tears"],
	["Johnny Cash", "Johnny Cash", "Blood, Sweat & Tears"],
	["Daft Punk", "Daft Punk", "Discovery"],
	["Daft Punk feat. Todd Edwards", "daft punk", "Discovery"],
	["Foo Fighters", "", "The Colour and the Shape"],
	["", "", "Field Recordings"],
];

const rowOf = ([artist, albumArtist, album]: (typeof LIBRARY)[number]) => {
	const row: string[] = [];
	row[FIELD.artist] = artist;
	row[FIELD.albumArtist] = albumArtist;
	row[FIELD.album] = album;
	return row;
};

const rows = LIBRARY.map(rowOf);
const columns = libraryColumnsOf(rows, TRACK_EXPRESSIONS.length);

test("a route naming only half a record is not a record", () => {
	assert.equal(albumOfRoute("album/discovery"), null);
	assert.equal(albumOfRoute("album/daft%20punk/"), null);
	assert.equal(albumOfRoute("artist/daft%20punk"), null);
	assert.equal(albumOfRoute("album/daft%2/discovery"), null);
});

test("a title carrying a slash is not read as two segments", () => {
	const route = albumRoute("Godspeed You! Black Emperor", "Yanqui U.X.O./Live");
	assert.deepEqual(albumOfRoute(route), {
		artist: "godspeed you! black emperor",
		album: "yanqui u.x.o./live",
	});
});

test("the groups of a column are built once for as long as the column is the same object", () => {
	const album = columns.fields[FIELD.album];

	assert.equal(tagGroups(album), tagGroups(album));
	assert.equal(artistGroups(columns), artistGroups({ ...columns }));
});

test("a column that has been replaced is grouped afresh, with what it now holds", () => {
	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	collector.add(rows.slice(0, 2));
	const before = collector.table();
	collector.add(rows.slice(2));
	const after = collector.table();

	const few = tagGroups(before.fields[FIELD.album]);
	const all = tagGroups(after.fields[FIELD.album]);

	assert.deepEqual(few.names, ["Blood, Sweat & Tears"]);
	assert.deepEqual(all.names, [
		"Blood, Sweat & Tears",
		"Discovery",
		"The Colour and the Shape",
		"Field Recordings",
	]);
	assert.notEqual(artistGroups(before), artistGroups(after));
	assert.equal(artistGroups(after).group("daft punk") >= 0, true);
	assert.equal(artistGroups(before).group("daft punk"), -1);
});
