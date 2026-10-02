import assert from "node:assert/strict";
import test from "node:test";

import { guidOf, isQueueHead } from "../../src/domain/player/queue.ts";
import type { PlaylistAnnotation } from "../../src/shared/api/playlists.ts";
import type { QueuedTrack, QueueRead } from "../../src/shared/api/queue.ts";
import type { ActiveItem } from "../../src/shared/api/types.ts";

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

const queued = (entry: Partial<QueuedTrack>): QueuedTrack => ({
	title: "",
	artist: "",
	album: "",
	albumArtist: "",
	duration: 0,
	libraryPath: null,
	location: null,
	...entry,
});

const queueOf = (...entries: Partial<QueuedTrack>[]): QueueRead => ({
	revision: 1,
	entries: entries.map(queued),
});

const playing = (item: Partial<ActiveItem>): ActiveItem => ({
	columns: [],
	duration: 0,
	index: -1,
	path: null,
	libraryPath: null,
	album: null,
	albumArtist: null,
	playlistGuid: null,
	position: 0,
	subsong: 0,
	...item,
});

test("the row at the head of the queue is the queue's head", () => {
	const queue = queueOf(
		{ location: { playlistId: PLAYING_GUID, index: 14 } },
		{ location: { playlistId: PLAYING_GUID, index: 21 } },
	);

	assert.equal(
		isQueueHead(queue, playing({ playlistGuid: PLAYING_GUID, index: 14 })),
		true,
	);
	assert.equal(
		isQueueHead(queue, playing({ playlistGuid: PLAYING_GUID, index: 21 })),
		false,
	);
	assert.equal(
		isQueueHead(queue, playing({ playlistGuid: OTHER_GUID, index: 14 })),
		false,
	);
});

test("a track queued off the library is matched by its library path", () => {
	const queue = queueOf({ libraryPath: "Artist/Album/01. Track.flac" });

	assert.equal(
		isQueueHead(queue, playing({ libraryPath: "Artist/Album/01. Track.flac" })),
		true,
	);
	assert.equal(
		isQueueHead(queue, playing({ libraryPath: "Artist/Album/02. Other.flac" })),
		false,
	);
});

test("nothing is the head of an empty or unread queue", () => {
	// A stopped player and a queue entry outside the library both carry no path,
	// and two absences are not a match.
	assert.equal(isQueueHead(queueOf({}), playing({})), false);
	assert.equal(isQueueHead(queueOf(), playing({ index: 3 })), false);
	assert.equal(isQueueHead(undefined, playing({ index: 3 })), false);
});
