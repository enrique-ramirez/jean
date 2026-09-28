import assert from "node:assert/strict";
import test from "node:test";

import { positionAt } from "../../src/domain/player/position.ts";
import type {
	PlaybackState,
	PlayerSnapshot,
} from "../../src/shared/api/types.ts";

const snapshot = ({
	position = 30,
	duration = 200,
	path = "C:\\Music\\a.flac" as string | null,
	playbackState = "playing" as PlaybackState,
	syncedAt = 1_000,
} = {}) =>
	({
		player: {
			activeItem: { position, duration, path },
			playbackState,
		},
		syncedAt,
	}) as unknown as PlayerSnapshot;

test("playing, the position counts on from the moment the snapshot was taken", () => {
	assert.equal(positionAt(snapshot(), 1_000), 30);
	assert.equal(positionAt(snapshot(), 3_500), 32.5);
});

test("paused or stopped, the position holds where the player left it", () => {
	for (const playbackState of ["paused", "stopped"] as PlaybackState[])
		assert.equal(
			positionAt(snapshot({ playbackState }), 60_000),
			30,
			playbackState,
		);
});

test("the position never runs past the end of the track", () => {
	assert.equal(positionAt(snapshot({ duration: 31 }), 60_000), 31);
});

test("nothing playing, or a row with no file, is at the start", () => {
	assert.equal(positionAt(null, 5_000), 0);
	assert.equal(positionAt(undefined, 5_000), 0);
	assert.equal(positionAt(snapshot({ path: null }), 5_000), 0);
});
