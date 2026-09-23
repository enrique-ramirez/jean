import assert from "node:assert/strict";
import test from "node:test";

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

test("the playback client exports the playback commands and no other function", async () => {
	const playback: Record<string, unknown> = await import(
		"../../src/shared/api/playback.ts"
	).catch(() => ({}));
	assert.deepEqual(
		Object.keys(playback)
			.filter((name) => typeof playback[name] === "function")
			.sort(),
		PLAYBACK_COMMANDS,
	);
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
