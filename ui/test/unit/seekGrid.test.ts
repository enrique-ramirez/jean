import assert from "node:assert/strict";
import test from "node:test";

import { seekGrid } from "../../src/features/now-playing/seekGrid.ts";
import { formatTime } from "../../src/shared/lib/time.ts";

const BARS = [
	{ duration: 277, devicePixels: 1280 },
	{ duration: 277, devicePixels: 1081 },
	{ duration: 12, devicePixels: 2400 },
	{ duration: 3600, devicePixels: 320 },
	{ duration: 199.37, devicePixels: 777 },
];

const positionsAlong = (duration: number) =>
	Array.from({ length: 4000 }, (_, step) => (step * duration) / 3999);

for (const { duration, devicePixels } of BARS) {
	const held = seekGrid(duration, devicePixels);
	const secondsPerPixel = duration / devicePixels;

	test(`a ${duration}s track on ${devicePixels} device pixels is never drawn a pixel behind`, () => {
		for (const at of positionsAlong(duration)) {
			assert.ok(held(at) <= at, `${at} was drawn ahead, at ${held(at)}`);
			assert.ok(
				at - held(at) < secondsPerPixel,
				`${at} was drawn at ${held(at)}`,
			);
		}
	});

	// What `aria-valuenow` rounds and `aria-valuetext` formats: a position held between two
	// redraws has to read as the exact one would, or a screen reader announces the last second.
	test(`a ${duration}s track on ${devicePixels} device pixels reads to the second as the exact position does`, () => {
		for (const at of positionsAlong(duration)) {
			assert.equal(Math.round(held(at)), Math.round(at), `at ${at}`);
			assert.equal(formatTime(held(at)), formatTime(at), `at ${at}`);
		}

		for (let half = 0; half <= duration * 2; half += 1)
			assert.equal(held(half / 2), half / 2);
	});
}

test("a track with no length holds its position on the half second", () => {
	assert.equal(seekGrid(0, 1280)(3.7), 3.5);
});

test("a bar that has not been measured holds its position on the half second", () => {
	assert.equal(seekGrid(277, 0)(3.7), 3.5);
});
