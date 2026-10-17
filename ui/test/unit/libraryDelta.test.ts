import assert from "node:assert/strict";
import test from "node:test";
import { artistIndex } from "../../src/domain/artist/artists.ts";
import { albumIndex } from "../../src/domain/track/albums.ts";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { genreIndex } from "../../src/domain/track/genres.ts";
import { INTENSITY_FIELDS } from "../../src/domain/track/intensity.ts";
import {
	type LibraryColumns,
	someFieldMoved,
} from "../../src/domain/track/libraryColumns.ts";
import { libraryIndex } from "../../src/domain/track/libraryIndex.ts";
import {
	librarySnapshotOf,
	patchedColumns,
} from "../../src/domain/track/librarySnapshot.ts";
import { generationKey } from "../../src/domain/track/playlistEntries.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import { createState } from "../fake-api/state.ts";

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

const declared = () => {
	const state = createState({ countsPlays: true });
	state.libraryFeed.columns = [...TRACK_EXPRESSIONS];
	state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	state.finishLibraryBuild();
	return state;
};

const exported = (state: ReturnType<typeof declared>) => {
	const library = decodeJlib(bufferOf(state.libraryExport()));
	assert.equal(library.kind, "snapshot");
	if (library.kind !== "snapshot") throw new Error("not a snapshot");
	return { library, held: librarySnapshotOf(library, TRACK_EXPRESSIONS) };
};

const patchedAfterPlay = (
	state: ReturnType<typeof declared>,
	held: LibraryColumns,
	since: number,
) => {
	const changes = state.libraryChanges(since);
	assert.equal(changes.status, 200);
	if (changes.status !== 200) throw new Error("no delta");

	const delta = decodeJlib(bufferOf(changes.bytes));
	if (delta.kind !== "delta") throw new Error("not a delta");

	const patched = patchedColumns(held, delta, TRACK_EXPRESSIONS);
	assert.ok(patched, "the delta did not apply");
	return { delta, patched };
};

const PLAYED_COLUMNS = ["%lastfm_last_played%", "%lastfm_play_count%"];

const LOCAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

test("a play moves the play count and the last-played stamp, and leaves every other column alone", () => {
	const state = declared();
	const { library, held } = exported(state);

	state.countPlay(state.libraryTracks[0]);
	const { delta, patched } = patchedAfterPlay(
		state,
		held.columns,
		library.revision,
	);

	assert.deepEqual([...delta.columns.keys()].sort(), PLAYED_COLUMNS);
	assert.equal(patched.load, held.columns.load);

	const moved = TRACK_EXPRESSIONS.filter(
		(_, field) => patched.fields[field] !== held.columns.fields[field],
	);
	assert.deepEqual([...moved].sort(), PLAYED_COLUMNS);

	const patch = delta.columns.get("%lastfm_play_count%");
	assert.ok(patch);
	assert.deepEqual(
		delta.columns.get("%lastfm_last_played%")?.ordinals,
		patch.ordinals,
	);

	const ordinal = patch.ordinals[0];
	assert.equal(
		Number(patched.fields[FIELD.playCount].at(ordinal)),
		Number(held.columns.fields[FIELD.playCount].at(ordinal)) + 1,
	);
	assert.match(
		String(patched.fields[FIELD.lastPlayed].at(ordinal)),
		LOCAL_TIMESTAMP,
	);
});

test("the folded search text and the entity groupings survive that patch", () => {
	const state = declared();
	const { library, held } = exported(state);
	const key = generationKey("component:test", library.structure);

	const index = libraryIndex(key, held.columns);
	const artists = artistIndex(key, held.columns, true);
	const genres = genreIndex(key, held.columns);

	state.countPlay(state.libraryTracks[0]);
	const { patched } = patchedAfterPlay(state, held.columns, library.revision);

	assert.equal(libraryIndex(key, patched), index);
	assert.equal(artistIndex(key, patched, true), artists);
	assert.equal(genreIndex(key, patched), genres);
});

test("what the play count is summed into does move", () => {
	const state = declared();
	const { library, held } = exported(state);
	const key = generationKey("component:summed", library.structure);

	const before = albumIndex(key, held.columns).reduce(
		(total, album) => total + album.plays,
		0,
	);

	state.countPlay(state.libraryTracks[0]);
	const { patched } = patchedAfterPlay(state, held.columns, library.revision);

	assert.ok(someFieldMoved(INTENSITY_FIELDS, held.columns, patched));
	assert.equal(
		albumIndex(key, patched).reduce((total, album) => total + album.plays, 0),
		before + 1,
	);
});

test("a structure rebuild re-keys the caches, so no folded id is inherited", () => {
	const state = declared();
	const { library, held } = exported(state);

	const first = generationKey("component:rebuilt", library.structure);
	const index = libraryIndex(first, held.columns);

	state.libraryFeed.building = [...TRACK_EXPRESSIONS].reverse();
	state.finishLibraryBuild();
	const next = exported(state);

	assert.notEqual(next.library.structure, library.structure);
	const second = generationKey("component:rebuilt", next.library.structure);
	assert.notEqual(second, first);
	assert.notEqual(libraryIndex(second, next.held.columns), index);
});

test("a revision from before a rebuild is refused rather than patched", () => {
	const state = declared();
	const { library } = exported(state);

	state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	state.finishLibraryBuild();

	assert.equal(state.libraryChanges(library.revision).status, 409);
});

// More plays than the 1920 revisions `kRetainedRevisions` keeps.
const PAST_THE_WINDOW = 2000;

test("a revision that fell out of the retained window is refused too", () => {
	const state = declared();
	const { library } = exported(state);

	for (let play = 0; play < PAST_THE_WINDOW; play += 1)
		state.countPlay(state.libraryTracks[play % state.libraryTracks.length]);

	assert.equal(state.libraryChanges(library.revision).status, 410);
});
