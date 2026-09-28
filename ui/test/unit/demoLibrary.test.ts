import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ALBUMS } from "../../demo/albums.ts";
import type { CapturedLibrary } from "../../demo/library.ts";

// The home screen is a set of claims about a collection, and against invented
// data every one of them is a picture of the generator. So the demo's library
// is only ever what `test/fake-api/capture.ts` read off a running foobar2000.

const DEMO = join(dirname(fileURLToPath(import.meta.url)), "../../demo");
const ARTWORK = join(DEMO, "artwork");

const library = JSON.parse(
	readFileSync(join(DEMO, "library.json"), "utf8"),
) as CapturedLibrary & { expressions: string[] };

// Changes with any edit to `library.json` or a cover. A fresh capture is the
// only reason for it to change, and whoever runs one records the new value.
const CAPTURE_DIGEST =
	"4466a14d3d9b11e792b9a84078c4ea65a7e91c7546d01ef4b1e38120a8ac8b6a";

const digestOfCapture = () => {
	const hash = createHash("sha256").update(
		readFileSync(join(DEMO, "library.json")),
	);
	for (const name of readdirSync(ARTWORK).sort())
		hash.update(name).update(readFileSync(join(ARTWORK, name)));
	return hash.digest("hex");
};

const keyOf = (album: { albumArtist: string; album: string }) =>
	`${album.albumArtist}\u0000${album.album}`;

test("the demo library names the foobar2000 it was captured from", () => {
	assert.match(library.capturedFrom, /^foobar2000 \d+\.\d+/);
});

test("the demo library holds exactly the records albums.ts asks the capture for", () => {
	assert.deepEqual(library.albums.map(keyOf).sort(), ALBUMS.map(keyOf).sort());
});

test("every captured track answers every expression the capture asked", () => {
	const short = library.albums.flatMap((album) =>
		album.tracks
			.filter((track) =>
				library.expressions.some((expression) => !(expression in track)),
			)
			.map(() => album.album),
	);

	assert.ok(library.expressions.length > 0);
	assert.deepEqual(short, []);
});

test("every captured record has the cover the player served for it", () => {
	const covers = new Set(readdirSync(ARTWORK));

	assert.deepEqual(
		library.albums
			.filter((album) => !album.artwork || !covers.has(album.artwork))
			.map((album) => album.album),
		[],
	);
});

test("the demo library and its covers are byte for byte the last capture", () => {
	assert.equal(
		digestOfCapture(),
		CAPTURE_DIGEST,
		"demo/library.json or demo/artwork changed without a capture. Run test/fake-api/capture.ts against a player and record the new digest here.",
	);
});
