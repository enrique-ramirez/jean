import assert from "node:assert/strict";
import test from "node:test";
import * as beefweb from "../../src/shared/api/beefweb.ts";

const PLAYBACK_COMMANDS = [
	"nextTrack",
	"playPause",
	"previousTrack",
	"seekBy",
	"seekTo",
	"setMuted",
	"setPlaybackOrder",
	"setVolume",
	"stop",
	"takeSkipAsked",
	"volumeDown",
	"volumeUp",
];

test("the beefweb client exports the playback commands and nothing else", () => {
	assert.deepEqual(Object.keys(beefweb).sort(), PLAYBACK_COMMANDS);
});

test("the player state module exports readTrack and libraryPathMatcher", async () => {
	const playerState: Record<string, unknown> = await import(
		"../../src/shared/api/playerState.ts"
	).catch(() => ({}));
	assert.deepEqual(
		{
			readTrack: typeof playerState.readTrack,
			libraryPathMatcher: typeof playerState.libraryPathMatcher,
		},
		{ readTrack: "function", libraryPathMatcher: "function" },
	);
});
