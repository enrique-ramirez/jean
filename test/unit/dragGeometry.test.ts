import assert from "node:assert/strict";
import test from "node:test";

import {
	autoscrollStep,
	landingOffset,
	offsetFor,
	type RowBox,
	targetFor,
} from "../../src/shared/lib/dragGeometry.ts";

// Four rows of the same height, laid out from the top of the viewport.
const EVEN: RowBox[] = [
	{ top: 0, height: 40 },
	{ top: 40, height: 40 },
	{ top: 80, height: 40 },
	{ top: 120, height: 40 },
];

// A short row between two tall ones, which is what a playlist row with a second line looks like.
const UNEVEN: RowBox[] = [
	{ top: 0, height: 60 },
	{ top: 60, height: 20 },
	{ top: 80, height: 60 },
];

test("a row that has not travelled stays where it is", () => {
	assert.equal(targetFor({ tops: EVEN, from: 1 }, 0), 1);
});

test("the swap happens when the rows cross, not when they touch", () => {
	// Overlapping row 2 is not enough: the dragged row's centre has to pass row 2's own centre,
	// which for even rows is a whole row of travel rather than half of one.
	assert.equal(targetFor({ tops: EVEN, from: 1 }, 39), 1);
	assert.equal(targetFor({ tops: EVEN, from: 1 }, 41), 2);
});

test("dragging up crosses the row above by the same rule", () => {
	assert.equal(targetFor({ tops: EVEN, from: 2 }, -39), 2);
	assert.equal(targetFor({ tops: EVEN, from: 2 }, -41), 1);
});

test("a drag past the ends lands on the first and last rows", () => {
	assert.equal(targetFor({ tops: EVEN, from: 0 }, 500), 3);
	assert.equal(targetFor({ tops: EVEN, from: 3 }, -500), 0);
});

test("the landing lines a row up with the top of the slot it moved up into", () => {
	assert.equal(landingOffset({ tops: EVEN, from: 2, to: 0 }), -80);
});

test("going down, the row lands against the bottom of the target rather than its top", () => {
	// The tall row 0 dropped onto the short row 1: its top comes to rest at row 1's bottom minus its
	// own height, which is not row 1's top.
	assert.equal(landingOffset({ tops: UNEVEN, from: 0, to: 1 }), 20);
	assert.equal(landingOffset({ tops: UNEVEN, from: 0, to: 2 }), 80);
});

test("a row dropped where it started does not move", () => {
	assert.equal(landingOffset({ tops: UNEVEN, from: 1, to: 1 }), 0);
});

test("the dragged row follows the pointer and the rest hold still", () => {
	const drag = { tops: EVEN, from: 0, to: 0, offset: 12 };
	assert.equal(offsetFor(drag, 0), 12);
	assert.deepEqual(
		[1, 2, 3].map((index) => offsetFor(drag, index)),
		[0, 0, 0],
	);
});

test("rows between the start and the landing slide up by one slot", () => {
	const drag = { tops: EVEN, from: 0, to: 2, offset: 85 };
	assert.equal(offsetFor(drag, 0), 85);
	assert.equal(offsetFor(drag, 1), -40);
	assert.equal(offsetFor(drag, 2), -40);
	assert.equal(offsetFor(drag, 3), 0);
});

test("dragging up slides the rows it passes down instead", () => {
	const drag = { tops: EVEN, from: 3, to: 1, offset: -85 };
	assert.equal(offsetFor(drag, 3), -85);
	assert.equal(offsetFor(drag, 2), 40);
	assert.equal(offsetFor(drag, 1), 40);
	assert.equal(offsetFor(drag, 0), 0);
});

test("a displaced row slides to the top its neighbour had, whatever the heights", () => {
	// Row 1 is 20 tall between two 60s. Passed downwards it takes row 0's top, and passed upwards it
	// takes row 2's, so the travel differs by direction rather than being one row height either way.
	assert.equal(offsetFor({ tops: UNEVEN, from: 0, to: 1, offset: 40 }, 1), -60);
	assert.equal(offsetFor({ tops: UNEVEN, from: 2, to: 1, offset: -40 }, 1), 20);
});

const BOX = { top: 100, bottom: 500 };

test("a pointer through the middle of a container scrolls it not at all", () => {
	assert.equal(autoscrollStep(BOX, 300), 0);
	assert.equal(autoscrollStep(BOX, 157), 0);
	assert.equal(autoscrollStep(BOX, 444), 0);
});

// One pair of numbers for every drag in the app: the reorder gesture and the drag onto a sidebar
// playlist take the same ramp, so a container's edge behaves the same whichever one is in flight.
test("the ramp reaches full speed at the edge and nothing at the zone's inner lip", () => {
	assert.equal(autoscrollStep(BOX, 100), -14);
	assert.equal(autoscrollStep(BOX, 128), -7);
	assert.equal(autoscrollStep(BOX, 500), 14);
	assert.equal(autoscrollStep(BOX, 472), 7);
});

test("past an edge is faster still, so a pointer dragged clear of the box keeps scrolling", () => {
	assert.ok(autoscrollStep(BOX, 40) < -14);
	assert.ok(autoscrollStep(BOX, 560) > 14);
});

test("in a container shorter than two zones the top wins", () => {
	assert.ok(autoscrollStep({ top: 0, bottom: 60 }, 30) < 0);
});
