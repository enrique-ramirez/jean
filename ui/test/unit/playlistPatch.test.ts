import assert from "node:assert/strict";
import test from "node:test";

import {
	type LibraryColumns,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { pathCollector } from "../../src/domain/track/pathTable.ts";
import type { PlaylistSnapshot } from "../../src/domain/track/playlistEntries.ts";
import {
	keptOrder,
	moveOrder,
	patchPlaylist,
	reorderedSnapshot,
} from "../../src/domain/track/playlistPatch.ts";
import {
	setWrittenRating,
	writtenRatingOf,
} from "../../src/domain/track/ratingStore.ts";
import type { PlaylistChanges } from "../../src/shared/api/playlists.ts";

const MAX_APPENDED_CHARS = 256 * 1024;

interface Row {
	path: string;
	subsong: number;
	title: string;
}

const ROWS: Row[] = [
	{ path: "Artist/Album/01 One.flac", subsong: 0, title: "One" },
	{ path: "Artist/Album/02 Two.flac", subsong: 0, title: "Two" },
];

const heldOf = (rows: Row[]) => {
	const columns = libraryColumnsOf(
		rows.map((row) => [row.title]),
		1,
	);
	const paths = pathCollector();
	for (const row of rows) paths.add(row.path);
	return {
		columns,
		paths: paths.table(),
		subsongs: Int32Array.from(rows.map((row) => row.subsong)),
	};
};

const titleAt = (columns: LibraryColumns, position: number) =>
	columns.fields[0].at(position);

const changeOf = (
	moved: { position: number; row: Row }[],
	revision: string,
): PlaylistChanges => ({
	revision,
	items: moved.map(({ position, row }) => ({
		position,
		libraryPath: row.path,
		subsong: row.subsong,
	})),
	columns: [
		{
			text: moved.map(({ row }) => row.title),
			ids: moved.map((_, at) => at),
		},
	],
});

test("no changed row is an unchanged snapshot, not a patch", () => {
	const held = heldOf(ROWS);
	assert.deepEqual(patchPlaylist(held, 0, changeOf([], "2")), {
		kind: "unchanged",
	});
});

test("a changed row whose address does not match what is held is a reload", () => {
	const held = heldOf(ROWS);
	const elsewhere: Row = { ...ROWS[1], path: "Artist/Album/99 Nine.flac" };
	const patch = patchPlaylist(
		held,
		0,
		changeOf([{ position: 1, row: elsewhere }], "2"),
	);
	assert.deepEqual(patch, { kind: "reload" });
});

test("a response naming a different column set than the one held is a reload", () => {
	const held = heldOf(ROWS);
	const changed = changeOf(
		[{ position: 1, row: { ...ROWS[1], title: "Zwei" } }],
		"2",
	);
	const patch = patchPlaylist(held, 0, {
		...changed,
		columns: [...changed.columns, changed.columns[0]],
	});
	assert.deepEqual(patch, { kind: "reload" });
});

test("a patch that would push the held text past the appended budget is a reload instead", () => {
	const held = heldOf(ROWS);
	const changed: Row = { ...ROWS[1], title: "Zwei" };
	const patch = patchPlaylist(
		held,
		MAX_APPENDED_CHARS,
		changeOf([{ position: 1, row: changed }], "2"),
	);
	assert.deepEqual(patch, { kind: "reload" });
});

test("a patch within budget replaces only the row that moved and grows the budget by what it added", () => {
	const held = heldOf(ROWS);
	const changed: Row = { ...ROWS[1], title: "Zwei" };
	const patch = patchPlaylist(
		held,
		10,
		changeOf([{ position: 1, row: changed }], "2"),
	);

	assert.equal(patch.kind, "patched");
	if (patch.kind !== "patched") return;
	assert.equal(titleAt(patch.columns, 0), "One");
	assert.equal(titleAt(patch.columns, 1), "Zwei");
	assert.equal(patch.appendedChars, 10 + "Zwei".length);
});

// The move `foo_jean` makes (`POST /playlists/{id}/items/move`): the named rows
// come out, keep their relative order, and land together so the first sits at
// `to`, counted in the playlist with them taken out. Each order reads
// `order[new] = old`. The first cases are `plannedMoves()` in the component's
// `tests/playlists_test.cpp`, so the plan Jean shows is the one the player makes.
const MOVES: {
	title: string;
	count: number;
	positions: number[];
	to: number;
	order: number[] | null;
}[] = [
	{
		title: "a contiguous block moved down lands after the rows it passed",
		count: 6,
		positions: [1, 2],
		to: 2,
		order: [0, 3, 1, 2, 4, 5],
	},
	{
		title: "a contiguous block moved up lands before the rows it passed",
		count: 6,
		positions: [4, 5],
		to: 1,
		order: [0, 4, 5, 1, 2, 3],
	},
	{
		title: "scattered rows land together in the order they had in the playlist",
		count: 6,
		positions: [0, 2, 5],
		to: 1,
		order: [1, 0, 2, 5, 3, 4],
	},
	{
		title: "a row moved to 0 becomes the first row",
		count: 6,
		positions: [3],
		to: 0,
		order: [3, 0, 1, 2, 4, 5],
	},
	{
		title: "rows moved to the count less the moved rows become the last rows",
		count: 6,
		positions: [1, 3],
		to: 4,
		order: [0, 2, 4, 5, 1, 3],
	},
	{
		title: "one row moved lands at the place named",
		count: 6,
		positions: [5],
		to: 2,
		order: [0, 1, 5, 2, 3, 4],
	},
	{
		title: "a block moved to where it already stands leaves every row in place",
		count: 6,
		positions: [2, 3],
		to: 2,
		order: [0, 1, 2, 3, 4, 5],
	},
	{
		title: "every row moved to 0 leaves every row in place",
		count: 6,
		positions: [0, 1, 2, 3, 4, 5],
		to: 0,
		order: [0, 1, 2, 3, 4, 5],
	},
	{
		title: "the last row moved to the end stays where it is",
		count: 6,
		positions: [5],
		to: 5,
		order: [0, 1, 2, 3, 4, 5],
	},
	{
		title: "the first row moved to the end becomes the last row",
		count: 6,
		positions: [0],
		to: 5,
		order: [1, 2, 3, 4, 5, 0],
	},
	{
		title: "a destination past the count less the moved rows is refused",
		count: 6,
		positions: [1, 3],
		to: 5,
		order: null,
	},
	{
		title: "every row moved anywhere but 0 is refused",
		count: 6,
		positions: [0, 1, 2, 3, 4, 5],
		to: 1,
		order: null,
	},
	{
		title: "a position past the last row is refused",
		count: 6,
		positions: [6],
		to: 0,
		order: null,
	},
	{
		title: "a position past the last row is refused beside one inside it",
		count: 6,
		positions: [2, 6],
		to: 0,
		order: null,
	},
	// Jean's own cases: a selection is named in the order it was made, and may
	// name a row twice, where the component's are read from runs.
	{
		title: "rows named out of order land in the order they had in the playlist",
		count: 6,
		positions: [4, 1],
		to: 2,
		order: [0, 2, 1, 4, 3, 5],
	},
	{
		// The bound counts distinct rows: [1, 1] moves one row, so 5 is its end.
		title:
			"a position named twice moves one row, and the end is counted without the duplicate",
		count: 6,
		positions: [1, 1],
		to: 5,
		order: [0, 2, 3, 4, 5, 1],
	},
	{
		title: "the only row of a one-row playlist stays where it is",
		count: 1,
		positions: [0],
		to: 0,
		order: [0],
	},
];

for (const move of MOVES)
	test(`moveOrder: ${move.title}`, () => {
		const order = moveOrder(move.count, move.positions, move.to);
		assert.deepEqual(order === null ? null : Array.from(order), move.order);
	});

interface HeldRow {
	path: string;
	subsong: number;
	title: string;
	artist: string;
	heat: number;
	patina: number;
}

// Two rows share a path and differ by subsong, as a cue sheet's tracks do, and
// two share an artist, so a column's ids repeat.
const HELD_ROWS: HeldRow[] = [
	{
		path: "Artist/Album/album.flac",
		subsong: 1,
		title: "One",
		artist: "Same",
		heat: 0.25,
		patina: 0,
	},
	{
		path: "Artist/Album/album.flac",
		subsong: 2,
		title: "Two",
		artist: "Same",
		heat: 0.5,
		patina: 0.125,
	},
	{
		path: "Artist/Other/03 Three.flac",
		subsong: 0,
		title: "Three",
		artist: "Else",
		heat: 0.75,
		patina: 0.25,
	},
	{
		path: "Artist/Other/04 Four.flac",
		subsong: 0,
		title: "Four",
		artist: "Same",
		heat: 1,
		patina: 0.5,
	},
];

// Not its own inverse, so an order applied the wrong way round shows.
const ORDER = [2, 0, 3, 1];
const HELD_STRUCTURE = 7;
const ANSWERED_STRUCTURE = 8;

const snapshotOf = (rows: HeldRow[]): PlaylistSnapshot => {
	const paths = pathCollector();
	for (const row of rows) paths.add(row.path);
	return {
		columns: libraryColumnsOf(
			rows.map((row) => [row.title, row.artist]),
			2,
		),
		structure: HELD_STRUCTURE,
		paths: paths.table(),
		subsongs: Int32Array.from(rows, (row) => row.subsong),
		loaded: rows.length,
		total: rows.length,
		isLoading: false,
		error: null,
		failure: null,
		heat: Float32Array.from(rows, (row) => row.heat),
		patina: Float32Array.from(rows, (row) => row.patina),
		playedCount: 3,
	};
};

const rowsOf = (snapshot: PlaylistSnapshot) =>
	Array.from({ length: snapshot.columns.trackCount }, (_, position) => ({
		path: snapshot.paths?.at(position),
		subsong: snapshot.subsongs?.[position],
		title: snapshot.columns.fields[0].at(position),
		artist: snapshot.columns.fields[1].at(position),
		heat: snapshot.heat[position],
		patina: snapshot.patina[position],
	}));

test("a reordered snapshot shows at each position the values, address and intensity of the row the order names", () => {
	const reordered = reorderedSnapshot(
		snapshotOf(HELD_ROWS),
		ORDER,
		ANSWERED_STRUCTURE,
	);
	assert.deepEqual(
		rowsOf(reordered),
		ORDER.map((old) => HELD_ROWS[old]),
	);
	assert.equal(reordered.paths?.length, HELD_ROWS.length);
});

test("a reordered snapshot stands at the answered structure with its counts unchanged", () => {
	const reordered = reorderedSnapshot(
		snapshotOf(HELD_ROWS),
		ORDER,
		ANSWERED_STRUCTURE,
	);
	assert.equal(reordered.structure, ANSWERED_STRUCTURE);
	assert.equal(reordered.loaded, HELD_ROWS.length);
	assert.equal(reordered.total, HELD_ROWS.length);
	assert.equal(reordered.playedCount, 3);
	assert.equal(reordered.columns.trackCount, HELD_ROWS.length);
});

// A reorder brings no new text, so a column's ids keep meaning what they
// meant, and a delta patching the column later appends after the same base.
test("a reordered snapshot keeps each column's dictionary and moves only its ids", () => {
	const held = snapshotOf(HELD_ROWS);
	const reordered = reorderedSnapshot(held, ORDER, ANSWERED_STRUCTURE);

	for (let field = 0; field < held.columns.fields.length; field += 1) {
		const before = held.columns.fields[field];
		const after = reordered.columns.fields[field];
		assert.equal(after.distinct, before.distinct);
		for (let id = 0; id < before.distinct; id += 1)
			assert.equal(after.value(id), before.value(id));
		assert.deepEqual(
			Array.from(after.ids),
			ORDER.map((old) => before.ids[old]),
		);
	}
});

// The move is written optimistically, and a refusal puts the view back on the
// snapshot it held before.
test("reordering leaves the held snapshot showing the order it had", () => {
	const held = snapshotOf(HELD_ROWS);
	reorderedSnapshot(held, ORDER, ANSWERED_STRUCTURE);
	assert.deepEqual(rowsOf(held), HELD_ROWS);
	assert.equal(held.structure, HELD_STRUCTURE);
});

test("an order longer than the held rows is a programming error and throws", () => {
	const held = snapshotOf(HELD_ROWS);
	assert.throws(() =>
		reorderedSnapshot(held, [1, 0, 2, 3, 4], ANSWERED_STRUCTURE),
	);
});

test("an order naming fewer rows than are held leaves the others out and counts what remains", () => {
	const held = snapshotOf(HELD_ROWS);
	const kept = keptOrder(HELD_ROWS.length, [1]);
	assert.deepEqual(Array.from(kept ?? []), [0, 2, 3]);

	const shortened = reorderedSnapshot(held, kept ?? [], ANSWERED_STRUCTURE);
	assert.deepEqual(
		rowsOf(shortened),
		[0, 2, 3].map((old) => HELD_ROWS[old]),
	);
	assert.equal(shortened.loaded, HELD_ROWS.length - 1);
	assert.equal(shortened.total, HELD_ROWS.length - 1);
	assert.equal(shortened.paths?.length, HELD_ROWS.length - 1);
});

test("a removal naming a row the playlist does not hold is refused", () => {
	assert.equal(keptOrder(HELD_ROWS.length, [HELD_ROWS.length]), null);
	assert.equal(keptOrder(HELD_ROWS.length, [-1]), null);
});

// A rating is drawn from what was written until the player's delta confirms
// it, and what was written is held by row position. Whether it follows its row
// through the reorder or waits for the delta, it never lands on another row.
test("a rating written before a reorder never shows on a row it was not written to", () => {
	const held = snapshotOf(HELD_ROWS);
	setWrittenRating(held.columns, 2, "5");

	const reordered = reorderedSnapshot(held, ORDER, ANSWERED_STRUCTURE);
	const now = ORDER.indexOf(2);
	for (let position = 0; position < ORDER.length; position += 1)
		if (position !== now)
			assert.equal(writtenRatingOf(reordered.columns, position), undefined);
});
