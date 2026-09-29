import assert from "node:assert/strict";
import test from "node:test";

import { lagSeconds, streamTimeAt } from "../../src/domain/player/listener.ts";
import {
	countStall,
	formatToTry,
	stallVerdict,
	type Watched,
} from "../../src/domain/player/streamHealth.ts";

const playing: Watched = {
	now: 100_000,
	currentTime: 42,
	lastTime: 42,
	lastAdvance: 100_000,
	connectAt: 0,
	hasRendered: true,
	isLowLatency: false,
	isPaused: false,
	playerState: "playing",
};

test("audio that moved since the last look has advanced", () => {
	assert.equal(stallVerdict({ ...playing, currentTime: 43 }), "advanced");
});

test("a short pause in the audio, or a paused element, is waited out", () => {
	assert.equal(stallVerdict({ ...playing, lastAdvance: 97_000 }), "wait");
	assert.equal(
		stallVerdict({ ...playing, lastAdvance: 0, isPaused: true }),
		"wait",
	);
});

test("audio stuck while the player plays is a dead stream, and reconnects", () => {
	assert.equal(stallVerdict({ ...playing, lastAdvance: 90_000 }), "reconnect");
});

test("audio stuck while the player has stopped is the player, not the stream", () => {
	assert.equal(
		stallVerdict({ ...playing, lastAdvance: 90_000, playerState: "paused" }),
		"player silent",
	);
});

test("a stream that has not started yet is given longer than one that went quiet", () => {
	const starting = {
		...playing,
		hasRendered: false,
		currentTime: 0,
		lastTime: 0,
	};
	assert.equal(stallVerdict({ ...starting, lastAdvance: 90_000 }), "wait");
	assert.equal(stallVerdict({ ...starting, lastAdvance: 60_000 }), "reconnect");
});

test("the low-latency path that never produced a sound is retired", () => {
	assert.equal(
		stallVerdict({
			...playing,
			hasRendered: false,
			isLowLatency: true,
			connectAt: 90_000,
		}),
		"retire low latency",
	);
});

test("stalls count only inside their window, and the third one is too many", () => {
	const first = countStall([], 1_000);
	const second = countStall(first.stalls, 2_000);
	assert.equal(second.isTooMany, false);
	assert.equal(countStall(second.stalls, 3_000).isTooMany, true);
	assert.deepEqual(countStall(second.stalls, 40_000).stalls, [40_000]);
});

test("the format tried is the first offered one that has not failed", () => {
	assert.equal(formatToTry(["opus", "aac"], new Set()), "opus");
	assert.equal(formatToTry(["opus", "aac"], new Set(["opus"])), "aac");
	assert.equal(formatToTry(["opus"], new Set(["opus"])), null);
});

test("the stream clock runs on from its last reading, and the lag is what has not been heard", () => {
	const reading = { streamTime: 120, readAt: 10_000 };
	assert.equal(streamTimeAt(reading, 12_500), 122.5);
	assert.equal(lagSeconds(reading, 100, 20, 12_500), 2.5);
});
