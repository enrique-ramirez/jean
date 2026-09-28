import assert from "node:assert/strict";
import test from "node:test";

import { guidOf } from "../../src/domain/player/queue.ts";
import type { PlaylistAnnotation } from "../../src/shared/api/fooJean.ts";

const PLAYING_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
const OTHER_GUID = "9f2a1c60-0b7e-4f21-8f0a-3a6d6c5e1f44";

const annotation = (
	entry: Partial<PlaylistAnnotation> & { id: string },
): PlaylistAnnotation => ({
	index: 0,
	title: "Playlist",
	itemCount: 0,
	isAutoPlaylist: false,
	role: null,
	structure: "0",
	revision: "0",
	managed: null,
	...entry,
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
