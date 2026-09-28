import assert from "node:assert/strict";
import test from "node:test";

import {
	CUSHION_AFTER_STALL_MS,
	CUSHION_MS,
	Cushion,
} from "../../src/domain/player/cushion.ts";

const PACKET_MS = 20;

// Feeds one packet at a time, the way the stream arrives, and says after how much audio the
// first append was allowed.
function msUntilFirstAppend(cushion: Cushion, limitMs = 10_000): number | null {
	for (let fed = PACKET_MS; fed <= limitMs; fed += PACKET_MS) {
		if (cushion.add(Uint8Array.of(fed & 0xff), PACKET_MS).length > 0)
			return fed;
	}
	return null;
}

function assertStartsOn(cushion: Cushion, goalMs: number) {
	const startedAt = msUntilFirstAppend(cushion);
	assert.ok(
		startedAt !== null && startedAt >= goalMs && startedAt < goalMs + PACKET_MS,
		`started after ${startedAt} ms, where the cushion is ${goalMs} ms`,
	);
}

// Good wifi and no stall: the stream plays as early as the element will take it.
test("before any stall, the first audio goes straight through", () => {
	const first = Uint8Array.of(1);
	assert.deepEqual(new Cushion(false).add(first, PACKET_MS), [first]);
});

test("the cushion after a stall is larger than the one after a seek", () => {
	assert.ok(CUSHION_AFTER_STALL_MS > CUSHION_MS);
});

test("after a stall, playback waits for the larger cushion", () => {
	const cushion = new Cushion(false);
	cushion.add(Uint8Array.of(1), PACKET_MS);

	cushion.stalled();

	assertStartsOn(cushion, CUSHION_AFTER_STALL_MS);
});

// A reconnect is a new connection within the same listening session.
test("a connection opened after a stall starts on the larger cushion", () => {
	assertStartsOn(new Cushion(true), CUSHION_AFTER_STALL_MS);
});

test("what was held goes out whole and in order once the cushion is there", () => {
	const cushion = new Cushion(true);
	const fed: Uint8Array[] = [];
	let released: Uint8Array[] = [];

	while (released.length === 0) {
		const packet = Uint8Array.of(fed.length);
		fed.push(packet);
		released = cushion.add(packet, PACKET_MS);
	}

	assert.deepEqual(released, fed);
});

test("once the cushion is there, audio goes straight through", () => {
	const cushion = new Cushion(true);
	msUntilFirstAppend(cushion);

	const next = Uint8Array.of(99);
	assert.deepEqual(cushion.add(next, PACKET_MS), [next]);
});

test("a seek with no stall behind it refills to the short cushion", () => {
	const cushion = new Cushion(false);

	cushion.flush();

	assertStartsOn(cushion, CUSHION_MS);
});

test("a seek refills to the larger cushion once a stall has grown it", () => {
	const cushion = new Cushion(false);
	cushion.stalled();
	msUntilFirstAppend(cushion);

	cushion.flush();

	assertStartsOn(cushion, CUSHION_AFTER_STALL_MS);
});

// Audio held from before a seek is from before it: appending it would play the old position.
test("a seek drops what was still being held", () => {
	const cushion = new Cushion(true);
	cushion.add(Uint8Array.of(1), PACKET_MS);

	cushion.flush();

	const released: Uint8Array[] = [];
	while (released.length === 0)
		released.push(...cushion.add(Uint8Array.of(2), PACKET_MS));
	assert.ok(released.every((packet) => packet[0] === 2));
});
