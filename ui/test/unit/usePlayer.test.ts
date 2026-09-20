import assert from "node:assert/strict";
import test from "node:test";

import { resolvedPlaylistId } from "../../src/domain/player/usePlayer.ts";
import type { PlaylistInfo } from "../../src/shared/api/types.ts";

// The e2e suite covers what this is for: the playing row highlighted in the
// right playlist, a scratch playlist left alone while the player is on it.
// What stays here is the third answer. A browser cannot be asked to hold the
// playlist list half-read, and "cannot say yet" is what every consumer of
// this resolution has to tell apart from "no playlist", since they act on
// one and wait on the other.

const PLAYING_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
const OTHER_GUID = "9f2a1c60-0b7e-4f21-8f0a-3a6d6c5e1f44";

const SETTLED = true;
const ARRIVING = false;

const playlist = (
	entry: Partial<PlaylistInfo> & { id: string },
): PlaylistInfo => ({
	index: 0,
	isCurrent: false,
	itemCount: 0,
	title: "Playlist",
	totalTime: 0,
	structure: 0,
	revision: 0,
	role: null,
	...entry,
});

test("confirms a GUID the settled list carries", () => {
	const playlists = [playlist({ id: PLAYING_GUID })];

	assert.equal(
		resolvedPlaylistId(PLAYING_GUID, playlists, SETTLED),
		PLAYING_GUID,
	);
});

test("answers no playlist for a GUID the settled list does not carry", () => {
	const playlists = [playlist({ id: OTHER_GUID })];

	assert.equal(resolvedPlaylistId(PLAYING_GUID, playlists, SETTLED), null);
});

test("answers not yet for a GUID while the list is still arriving", () => {
	assert.equal(resolvedPlaylistId(PLAYING_GUID, [], ARRIVING), undefined);
});

test("answers no playlist for a track playing from none, however the list stands", () => {
	assert.equal(resolvedPlaylistId(null, [], ARRIVING), null);
});
