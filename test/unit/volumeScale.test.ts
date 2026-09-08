import assert from "node:assert/strict";
import test from "node:test";

import {
	fractionToVolume,
	volumePercent,
	volumeToFraction,
} from "../../src/domain/player/volumeScale.ts";

// `sliders.spec.ts` drags the fader and asserts where it lands, which is the
// user-visible half and stays there. The round trip and the two degenerate
// players below cannot be reached through the UI at all.

const DB = { type: "db", min: -100, max: 0, value: 0, isMuted: false } as const;
const at = (value: number) => ({ ...DB, value });

test("a fraction survives the round trip through decibels", () => {
	for (const fraction of [0, 0.05, 0.25, 0.5, 0.75, 0.99, 1]) {
		const db = fractionToVolume(DB, fraction);
		assert.ok(
			Math.abs(volumeToFraction(at(db)) - fraction) < 0.001,
			`${fraction} came back as ${volumeToFraction(at(db))}`,
		);
	}
});

test("the ends of the travel are the player's own ends", () => {
	assert.equal(fractionToVolume(DB, 0), DB.min);
	assert.equal(fractionToVolume(DB, 1), DB.max);
	assert.equal(volumeToFraction(at(DB.min)), 0);
	assert.equal(volumeToFraction(at(DB.max)), 1);
});

test("half the travel is half as loud, which is -10 dB", () => {
	assert.ok(Math.abs(fractionToVolume(DB, 0.5) + 10) < 0.1);
});

test("a fraction outside the fader is clamped rather than extrapolated", () => {
	assert.equal(fractionToVolume(DB, 2), DB.max);
	assert.equal(fractionToVolume(DB, -1), DB.min);
});

test("a player whose silence is nearer to zero keeps the same shape", () => {
	const shallow = { ...DB, min: -50 };
	assert.equal(fractionToVolume(shallow, 0), -50);
	assert.equal(volumeToFraction({ ...shallow, value: -50 }), 0);
});

test("a player with no travel to describe answers zero rather than NaN", () => {
	const flat = { ...DB, min: 0, max: 0, value: 0 };
	assert.equal(volumeToFraction(flat), 0);
	assert.equal(fractionToVolume(flat, 0.5), 0);
	assert.ok(Number.isFinite(fractionToVolume(flat, 0)));
});

test("a linear player is read linearly", () => {
	const linear = {
		type: "linear",
		min: 0,
		max: 100,
		value: 25,
		isMuted: false,
	} as const;
	assert.equal(volumeToFraction(linear), 0.25);
	assert.equal(fractionToVolume(linear, 0.4), 40);
});

test("no volume at all is silence rather than a crash", () => {
	assert.equal(volumeToFraction(null), 0);
	assert.equal(volumePercent(undefined), 0);
});
