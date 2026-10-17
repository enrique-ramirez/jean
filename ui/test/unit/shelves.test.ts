import assert from "node:assert/strict";
import test from "node:test";

import { refsOfShelf } from "../../src/features/home/shelves.ts";

const shelfOf = (...albums: number[][]) => ({
	albums: albums.map((ordinals) => ({ ordinals })),
});

test("refsOfShelf answers every album's ordinals ascending, in library order rather than shelf order", () => {
	assert.deepEqual(
		[...refsOfShelf(shelfOf([40, 41, 100], [9, 10], [5, 70]))],
		[5, 9, 10, 40, 41, 70, 100],
	);
});

test("refsOfShelf answers nothing for a shelf with no albums", () => {
	assert.deepEqual([...refsOfShelf(shelfOf())], []);
});
