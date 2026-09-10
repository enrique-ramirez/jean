import assert from "node:assert/strict";
import test from "node:test";
import { albumOfRoute, albumRoute } from "../../src/domain/track/albumRoute.ts";
import {
	albumIndex,
	albumsOf,
	refsOfAlbum,
} from "../../src/domain/track/albums.ts";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	columnCollector,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { trackRows } from "../../src/domain/track/project.ts";
import { rankEntities } from "../../src/domain/track/rankEntities.ts";
import { TIER } from "../../src/shared/lib/text.ts";

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

const albums = albumsOf(trackRows(columns));
const find = (artist: string, album: string) =>
	albums.find(
		(entry) =>
			entry.album.toLowerCase() === album.toLowerCase() &&
			entry.artistTag?.toLowerCase() === artist.toLowerCase(),
	);

test("one title by two bands is two records", () => {
	const shared = albums.filter(
		(entry) => entry.album === "Blood, Sweat & Tears",
	);
	assert.equal(shared.length, 2);
	assert.deepEqual(
		shared.map((entry) => entry.trackCount),
		[1, 1],
	);
});

test("one record whose album artist is spelt two ways is one record", () => {
	assert.equal(find("Daft Punk", "Discovery")?.trackCount, 2);
});

test("a missing album artist falls back to the track's own", () => {
	assert.equal(find("Foo Fighters", "The Colour and the Shape")?.trackCount, 1);
});

test("a record with neither artist tag is still a record", () => {
	const loose = albums.find((entry) => entry.album === "Field Recordings");
	assert.equal(loose?.trackCount, 1);
	// The absence is what addresses it. A record carries no name to draw, since what to
	// call an untagged one is a phrase and would be in whichever language built the index.
	assert.equal(loose?.artistTag, null);
});

test("the rows a record's page draws are the ones its count promised", () => {
	for (const album of albums) {
		const found = refsOfAlbum(columns, album.artistTag, album.album);
		assert.equal(found.refs.length, album.trackCount, album.album);
	}
});

test("the record's own spelling comes back with its rows, not the route's", () => {
	const found = refsOfAlbum(columns, "daft punk", "discovery");
	assert.equal(found.album, "Discovery");
	assert.equal(found.artist, "Daft Punk");
	assert.deepEqual([...found.refs], [2, 3]);
});

test("an empty title matches nothing rather than everything untagged", () => {
	assert.equal(refsOfAlbum(columns, "Daft Punk", "  ").refs.length, 0);
});

test("a record survives the trip through its own address", () => {
	for (const album of albums) {
		const route = albumRoute(album.artistTag, album.album);
		const back = albumOfRoute(route);
		assert.ok(back, route);
		assert.equal(
			refsOfAlbum(columns, back.artist, back.album).refs.length,
			album.trackCount,
			route,
		);
	}
});

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

test("the index takes in rows that arrive after it was first asked for", () => {
	const key = "library:6";

	const collector = columnCollector(TRACK_EXPRESSIONS.length);
	collector.add(rows.slice(0, 1));
	assert.equal(albumIndex(key, collector.table()).length, 1);

	collector.add(rows.slice(1));
	const grown = albumIndex(key, collector.table());
	assert.equal(grown.length, albums.length);
	assert.equal(
		grown.find((entry) => entry.album === "Discovery")?.trackCount,
		2,
	);
});

const named = (query: string, floor = TIER.word) =>
	rankEntities(albums, query, floor).map((entry) => entry.album);

test("a title the query holds whole is offered; one it only contains is not", () => {
	assert.deepEqual(named("discovery"), ["Discovery"]);
	assert.deepEqual(named("colour"), ["The Colour and the Shape"]);
	assert.deepEqual(named("scover"), []);
});

test("two records sharing a title are two rows, not one", () => {
	const both = rankEntities(albums, "blood, sweat & tears", TIER.word);
	assert.equal(both.length, 2);
	assert.deepEqual(
		both.map((entry) => entry.artistTag),
		["Blood, Sweat & Tears", "Johnny Cash"],
	);
});
