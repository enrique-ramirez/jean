import assert from "node:assert/strict";
import test from "node:test";

import { rovedIndex } from "../../src/shared/lib/rove.ts";

test("a list with nothing focused starts at whichever end the arrow points from", () => {
	assert.equal(rovedIndex("ArrowDown", -1, 5), 0);
	assert.equal(rovedIndex("ArrowUp", -1, 5), 4);
});

test("a list stops at its ends unless it wraps", () => {
	assert.equal(rovedIndex("ArrowDown", 4, 5), 4);
	assert.equal(rovedIndex("ArrowUp", 0, 5), 0);
	assert.equal(rovedIndex("ArrowDown", 4, 5, { wrap: true }), 0);
	assert.equal(rovedIndex("ArrowUp", 0, 5, { wrap: true }), 4);
});

test("a grid steps a row with the vertical arrows and a tile with the horizontal ones", () => {
	const grid = { columns: 3, horizontal: true };
	assert.equal(rovedIndex("ArrowDown", 1, 9, grid), 4);
	assert.equal(rovedIndex("ArrowUp", 4, 9, grid), 1);
	assert.equal(rovedIndex("ArrowRight", 4, 9, grid), 5);
	assert.equal(rovedIndex("ArrowLeft", 4, 9, grid), 3);
	assert.equal(rovedIndex("ArrowDown", 7, 9, grid), 8);
});

test("keys a list does not answer leave focus where it is", () => {
	assert.equal(rovedIndex("ArrowRight", 2, 5), null);
	assert.equal(rovedIndex("Home", 2, 5), null);
	assert.equal(rovedIndex("Enter", 2, 5), null);
	assert.equal(rovedIndex("ArrowDown", -1, 0), null);
});

test("Home and End reach the ends where a list asks for them", () => {
	assert.equal(rovedIndex("Home", 3, 5, { ends: true }), 0);
	assert.equal(rovedIndex("End", 1, 5, { ends: true }), 4);
});
