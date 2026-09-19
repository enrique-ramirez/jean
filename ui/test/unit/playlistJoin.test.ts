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
	index: 0,
	title: "Playlist",
	itemCount: 0,
	isAutoPlaylist: false,
	role: null,
	structure: 0,
	revision: 0,
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

test("confirms a GUID the settled annotations carry", () => {
	const entries = [annotation({ id: PLAYING_GUID })];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, [], SETTLED), PLAYING_GUID);
});

test("confirms a GUID only the playlist list carries", () => {
	const playlists = [playlist({ id: PLAYING_GUID })];

	assert.equal(beefwebIdOf(PLAYING_GUID, [], playlists, SETTLED), PLAYING_GUID);
});

test("answers no playlist for a GUID the settled annotations do not carry", () => {
	const entries = [annotation({ id: OTHER_GUID })];

	assert.equal(beefwebIdOf(PLAYING_GUID, entries, [], SETTLED), null);
});

test("answers not yet for a GUID while the annotations are still arriving", () => {
	assert.equal(beefwebIdOf(PLAYING_GUID, [], [], ARRIVING), undefined);
});

test("answers no playlist for a track playing from none, however the annotations stand", () => {
	assert.equal(beefwebIdOf(null, [], [], ARRIVING), null);
});

test("confirms an id already the GUID list carries", () => {
	const entries = [
		annotation({ id: OTHER_GUID }),
		annotation({ id: PLAYING_GUID }),
	];

	assert.equal(guidOf(PLAYING_GUID, entries), PLAYING_GUID);
});

test("refuses an id no annotation carries rather than naming another playlist", () => {
	const entries = [annotation({ id: OTHER_GUID })];

	assert.throws(() => guidOf(PLAYING_GUID, entries), Error);
	// The component answers no list at all where it cannot read the player's
	// playlists, and that is the same refusal rather than a crash at the seam.
	assert.throws(() => guidOf(PLAYING_GUID, null), Error);
});
