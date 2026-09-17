import assert from "node:assert/strict";
import test from "node:test";

import { beefwebIdOf, guidOf } from "../../src/domain/player/playlistJoin.ts";
import type { PlaylistAnnotation } from "../../src/shared/api/fooJean.ts";
import type { PlaylistInfo } from "../../src/shared/api/types.ts";

// The e2e suite covers what the join is for: the playing row highlighted in the
// right playlist, a scratch playlist left alone while the player is on it. What
// stays here is the third answer. A browser cannot be asked to hold the
// annotations half-read, and "cannot say yet" is what every consumer of this
// join has to tell apart from "no playlist", since they act on one and wait on
// the other.

const PLAYING_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
const OTHER_GUID = "9f2a1c60-0b7e-4f21-8f0a-3a6d6c5e1f44";

const SETTLED = true;
const ARRIVING = false;

const annotation = (
	entry: Partial<PlaylistAnnotation> & { id: string },
): PlaylistAnnotation => ({
	beefwebId: null,
	index: 0,
	title: "Playlist",
	isAutoPlaylist: false,
	managed: null,
	...entry,
});

const playlist = (
	entry: Partial<PlaylistInfo> & { id: string },
): PlaylistInfo => ({
	index: 0,
	isCurrent: false,
	itemCount: 0,
	title: "Playlist",
	totalTime: 0,
	...entry,
});

test("resolves a playlist GUID to the beefweb id its annotation carries", () => {
	const entries = [annotation({ id: PLAYING_GUID, beefwebId: "p7", index: 2 })];
	const playlists = [playlist({ id: "p3", index: 2 })];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, playlists, SETTLED), "p7");
});

test("falls back to the playlist at the annotation's index where beefweb has named none yet", () => {
	const entries = [annotation({ id: PLAYING_GUID, beefwebId: null, index: 2 })];
	const playlists = [
		playlist({ id: "p3", index: 1 }),
		playlist({ id: "p7", index: 2 }),
	];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, playlists, SETTLED), "p7");
});

test("answers no playlist where the annotation names neither an id nor an index beefweb knows", () => {
	const entries = [annotation({ id: PLAYING_GUID, beefwebId: null, index: 4 })];
	const playlists = [playlist({ id: "p3", index: 1 })];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, playlists, SETTLED), null);
});

test("answers no playlist for a GUID the settled annotations do not carry", () => {
	const entries = [annotation({ id: OTHER_GUID, beefwebId: "p3", index: 1 })];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, [], SETTLED), null);
});

test("answers not yet for a GUID while the annotations are still arriving", () => {
	assert.equal(beefwebIdOf(PLAYING_GUID, [], [], ARRIVING), undefined);
});

test("answers no playlist for a track playing from none, however the annotations stand", () => {
	assert.equal(beefwebIdOf(null, [], [], ARRIVING), null);
});

test("resolves a beefweb id back to the playlist GUID foo_jean addresses", () => {
	const entries = [
		annotation({ id: OTHER_GUID, beefwebId: "p3", index: 1 }),
		annotation({ id: PLAYING_GUID, beefwebId: "p7", index: 2 }),
	];

	assert.equal(guidOf("p7", entries), PLAYING_GUID);
});

test("refuses a beefweb id no annotation carries rather than naming another playlist", () => {
	const entries = [annotation({ id: OTHER_GUID, beefwebId: "p3", index: 1 })];

	assert.throws(() => guidOf("p7", entries), Error);
	// The component answers no list at all where it cannot read the player's
	// playlists, and that is the same refusal rather than a crash at the seam.
	assert.throws(() => guidOf("p7", null), Error);
});
