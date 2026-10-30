import assert from "node:assert/strict";
import test from "node:test";

import { windowedSourceOf } from "../../src/domain/track/librarySource.ts";

const source = windowedSourceOf({
	windows: { at: () => null },
	origin: "http://player.invalid:8881",
	listNow: () => null,
	coverOf: () => null,
});

const CUE_SHEET = "Artist/Record/Record.cue";

test("the playing track is found at its place in the view it is listed in", () => {
	const track = { path: "Artist/Record/03 Song.flac", subsong: 0 };
	const ordinal = 20;

	assert.equal(
		source.playingPosition(null, { ...track, libraryOrdinal: ordinal }),
		ordinal,
	);
	assert.equal(
		source.playingPosition(Int32Array.of(31, 4, ordinal, 9), {
			...track,
			libraryOrdinal: ordinal,
		}),
		2,
	);
	assert.equal(
		source.playingPosition(Int32Array.of(31, 4, 9), {
			...track,
			libraryOrdinal: ordinal,
		}),
		-1,
	);
});

test("the playing subsong of a cue sheet is told from its siblings, which share its path", () => {
	const refs = Int32Array.of(41, 40, 42);

	assert.equal(
		source.playingPosition(refs, {
			path: CUE_SHEET,
			subsong: 2,
			libraryOrdinal: 41,
		}),
		0,
	);
	assert.equal(
		source.playingPosition(refs, {
			path: CUE_SHEET,
			subsong: 1,
			libraryOrdinal: 40,
		}),
		1,
	);
});

test("a track the library does not hold, or no track, has no place", () => {
	const notHeld = { path: "Elsewhere/Not here.flac", subsong: 0 };

	for (const refs of [null, Int32Array.of(0, 1, 2)]) {
		assert.equal(
			source.playingPosition(refs, { ...notHeld, libraryOrdinal: null }),
			-1,
		);
		assert.equal(source.playingPosition(refs, notHeld), -1);
		assert.equal(source.playingPosition(refs, null), -1);
	}
});
