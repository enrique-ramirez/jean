import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { artistIndex, refsOfArtist } from "../../src/domain/artist/artists.ts";
import { refsOfAlbum } from "../../src/domain/track/albums.ts";
import { FIELD } from "../../src/domain/track/fields.ts";
import { genreIndex } from "../../src/domain/track/genres.ts";
import {
	canonicalTrackRefs,
	groupByAlbum,
} from "../../src/domain/track/grouping.ts";
import { libraryIndex } from "../../src/domain/track/libraryIndex.ts";
import { canonicalArtworkUrl } from "../../src/domain/track/librarySource.ts";
import type { PathTable } from "../../src/domain/track/pathTable.ts";
import {
	emit,
	generationKey,
	heldEntry,
	type PlaylistSnapshot,
} from "../../src/domain/track/playlistEntries.ts";
import {
	refsOfGenre,
	trackRows,
	wholeLibrary,
} from "../../src/domain/track/project.ts";
import { searchIndex } from "../../src/domain/track/searchText.ts";
import {
	type Change,
	decodedSnapshot,
	loadedLibrary,
	NOW,
	type PlayLibrary,
	playLibrary,
	seeded,
	stamp,
} from "./playDeltaLibrary.ts";

const playedRows = (library: PlayLibrary): Change[] =>
	[0, 7, library.rows.length - 1].flatMap((ordinal) => [
		{ ordinal, field: FIELD.playCount, value: "1000" },
		{ ordinal, field: FIELD.lastPlayed, value: stamp(NOW) },
		{ ordinal, field: FIELD.playCountLocal, value: "12" },
		{ ordinal, field: FIELD.lastPlayedLocal, value: stamp(NOW) },
	]);

async function aroundAPlay(t: TestContext) {
	const library = playLibrary(seeded(23));
	const loaded = await loadedLibrary(t, library);
	const key = generationKey(loaded.key, library.structure);
	const before = loaded.snapshot();
	await loaded.apply(playedRows(library));
	const after = loaded.snapshot();
	assert.notEqual(after.heat, before.heat, "the play did not reach the store");
	return { library, loaded, key, before, after };
}

const albumOf = (library: PlayLibrary, ordinal: number) => {
	const row = library.rows[ordinal];
	const albumArtist = row[FIELD.albumArtist];
	return {
		artist: albumArtist === "?" ? row[FIELD.artist] : albumArtist,
		album: row[FIELD.album],
	};
};

const reversed = ({ columns }: PlaylistSnapshot) =>
	trackRows(
		columns,
		Int32Array.from(
			{ length: columns.trackCount },
			(_, at) => columns.trackCount - 1 - at,
		),
	);

test("the whole-library view keeps its rows across a play", async (t) => {
	const { before, after } = await aroundAPlay(t);

	assert.equal(wholeLibrary(after).indices, wholeLibrary(before).indices);
});

test("the album runs of the whole-library view survive a play", async (t) => {
	const { before, after } = await aroundAPlay(t);

	assert.equal(
		groupByAlbum(wholeLibrary(after)),
		groupByAlbum(wholeLibrary(before)),
	);
});

test("a view in another order still gets runs of its own", async (t) => {
	const { library, before, after } = await aroundAPlay(t);
	groupByAlbum(wholeLibrary(before));
	groupByAlbum(wholeLibrary(after));

	const fresh = {
		...after,
		columns: decodedSnapshot(library.rebuilt()).columns,
	};
	assert.deepEqual(
		groupByAlbum(reversed(after)),
		groupByAlbum(reversed(fresh)),
	);
});

test("the artist and genre indexes and the search haystack survive a play", async (t) => {
	const { key, before, after } = await aroundAPlay(t);

	assert.equal(
		artistIndex(key, after.columns, true),
		artistIndex(key, before.columns, true),
	);
	assert.equal(genreIndex(key, after.columns), genreIndex(key, before.columns));
	assert.equal(
		libraryIndex(key, after.columns),
		libraryIndex(key, before.columns),
	);
});

test("the finder's folded haystack survives a play", async (t) => {
	const { before, after } = await aroundAPlay(t);

	assert.equal(searchIndex(after.columns), searchIndex(before.columns));
});

test("an album page, an artist page and a genre page keep their tracks across a play", async (t) => {
	const { library, before, after } = await aroundAPlay(t);
	const { artist, album } = albumOf(library, 0);
	const genre = library.rows[0][FIELD.genre].split(", ")[0];
	const performer = library.rows[0][FIELD.artist];

	assert.equal(
		refsOfAlbum(after.columns, artist, album),
		refsOfAlbum(before.columns, artist, album),
	);
	assert.equal(
		refsOfArtist(after.columns, performer, true),
		refsOfArtist(before.columns, performer, true),
	);
	assert.equal(
		refsOfGenre(after.columns, genre),
		refsOfGenre(before.columns, genre),
	);
});

test("a second album, artist or genre asked after a play gets its own tracks", async (t) => {
	const { library, before, after } = await aroundAPlay(t);
	const first = albumOf(library, 0);
	refsOfAlbum(before.columns, first.artist, first.album);
	refsOfArtist(before.columns, library.rows[0][FIELD.artist], true);
	refsOfGenre(before.columns, "Rock");

	const other = library.rows.findIndex(
		(row) =>
			row[FIELD.album] !== first.album &&
			row[FIELD.album] !== "?" &&
			row[FIELD.artist] !== library.rows[0][FIELD.artist],
	);
	const second = albumOf(library, other);
	const fresh = decodedSnapshot(library.rebuilt()).columns;

	assert.deepEqual(
		refsOfAlbum(after.columns, second.artist, second.album),
		refsOfAlbum(fresh, second.artist, second.album),
	);
	assert.deepEqual(
		refsOfArtist(after.columns, library.rows[other][FIELD.artist], true),
		refsOfArtist(fresh, library.rows[other][FIELD.artist], true),
	);
	assert.deepEqual(
		refsOfGenre(after.columns, "Jazz"),
		refsOfGenre(fresh, "Jazz"),
	);
});

const countingReads = (paths: PathTable) => {
	const counted = { reads: 0, table: paths };
	counted.table = {
		length: paths.length,
		at: (index) => {
			counted.reads += 1;
			return paths.at(index);
		},
	};
	return counted;
};

test("the path table and the canonical path of every record survive a play", async (t) => {
	const library = playLibrary(seeded(23));
	const loaded = await loadedLibrary(t, library);
	const entry = heldEntry(loaded.key);
	assert.ok(entry);

	const paths = countingReads(loaded.snapshot().paths as PathTable);
	emit(entry, { paths: paths.table });
	const before = loaded.snapshot();
	const track = library.paths[1];
	const cover = canonicalArtworkUrl(loaded.origin, track);

	await loaded.apply(playedRows(library));
	const after = loaded.snapshot();

	assert.equal(after.paths, before.paths);

	paths.reads = 0;
	assert.equal(canonicalArtworkUrl(loaded.origin, track), cover);
	assert.ok(
		paths.reads < library.rows.length,
		`${paths.reads} paths read for one cover over ${library.rows.length} tracks`,
	);
});

test("the track each record's cover is asked at survives a play", async (t) => {
	const { before, after } = await aroundAPlay(t);

	assert.equal(
		canonicalTrackRefs(after.columns),
		canonicalTrackRefs(before.columns),
	);
});

test("another library's haystack is folded from its own titles", () => {
	const first = playLibrary(seeded(23));
	const read = searchIndex(decodedSnapshot(first.exported()).columns);
	for (let ref = 0; ref < first.rows.length; ref += 1) read.title.text(ref);

	const other = playLibrary(seeded(24));
	const index = searchIndex(decodedSnapshot(other.exported()).columns);
	assert.deepEqual(
		other.rows.map((_, ref) => index.title.text(ref)),
		other.rows.map((row) => row[FIELD.title].toLowerCase()),
	);
});

test("a tag edit still reaches the runs, the pages and the haystack", async (t) => {
	const library = playLibrary(seeded(23));
	const loaded = await loadedLibrary(t, library);
	const before = loaded.snapshot();
	const { artist, album } = albumOf(library, 0);
	groupByAlbum(wholeLibrary(before));
	refsOfAlbum(before.columns, artist, album);
	searchIndex(before.columns);

	await loaded.apply([
		{ ordinal: 0, field: FIELD.album, value: "Retitled record" },
		{ ordinal: 0, field: FIELD.title, value: "Retitled song" },
	]);
	const after = loaded.snapshot();
	const fresh = {
		...after,
		columns: decodedSnapshot(library.rebuilt()).columns,
	};

	assert.deepEqual(
		groupByAlbum(wholeLibrary(after)),
		groupByAlbum(wholeLibrary(fresh)),
	);
	assert.deepEqual(
		refsOfAlbum(after.columns, artist, album),
		refsOfAlbum(fresh.columns, artist, album),
	);
	assert.equal(searchIndex(after.columns).title.text(0), "retitled song");
});
