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

test("audio stuck while the player has stopped is the player, not the stream, after the same grace a stall gets", () => {
	assert.equal(
		stallVerdict({ ...playing, lastAdvance: 97_000, playerState: "paused" }),
		"wait",
	);
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

test("the low-latency path that never produced a sound is retired, counted from the last advance rather than the connection", () => {
	const unheard = { ...playing, hasRendered: false, isLowLatency: true };
	assert.equal(
		stallVerdict({ ...unheard, lastAdvance: 90_000 }),
		"retire low latency",
	);
	assert.equal(stallVerdict({ ...unheard, lastAdvance: 96_000 }), "wait");
});

// foo_jean sends no audio for a session with no track yet, or for a stopped player, so a stream
// that has not sounded says nothing about the short buffer.
test("a stream that has never sounded while the player is quiet is silent at once, and the low-latency path is not retired", () => {
	const unheard = {
		...playing,
		hasRendered: false,
		playerState: "stopped" as const,
	};
	assert.equal(
		stallVerdict({ ...unheard, lastAdvance: 99_500 }),
		"player silent",
	);
	assert.equal(
		stallVerdict({ ...unheard, isLowLatency: true, lastAdvance: 90_000 }),
		"player silent",
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
