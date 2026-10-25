import assert from "node:assert/strict";
import test from "node:test";

import { keptOrder, moveOrder } from "../../src/domain/track/playlistPatch.ts";

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

const HELD = 6;

test("a removal keeps every other row in the order it had, each at its old position", () => {
	assert.deepEqual(Array.from(keptOrder(HELD, [4, 1]) ?? []), [0, 2, 3, 5]);
});

test("a removal naming a row the playlist does not hold is refused", () => {
	assert.equal(keptOrder(HELD, [HELD]), null);
	assert.equal(keptOrder(HELD, [-1]), null);
});
