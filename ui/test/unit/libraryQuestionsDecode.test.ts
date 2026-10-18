import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { LIBRARY_ROLES } from "../../src/domain/track/libraryAsker.ts";
import { fetchLibraryAnswer } from "../../src/shared/api/libraryQuestions.ts";

const ORIGIN = "http://decode.invalid:8881";
const LIBRARY = { structure: 4, trackCount: 10 };

const answering = (t: TestContext, body: unknown) => {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (() =>
		Promise.resolve(Response.json(body))) as typeof fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
};

const askAlbum = () =>
	fetchLibraryAnswer(
		ORIGIN,
		{ kind: "album", artist: null, album: "a" },
		LIBRARY_ROLES,
		LIBRARY,
	);

const albumAt = (refs: unknown, structure = LIBRARY.structure) => ({
	structure,
	revision: 1,
	refs,
	album: "a",
	artist: null,
});

for (const [why, refs] of [
	["a run that starts below zero", { runs: [[-5, 2]] }],
	["a run that ends past the library", { runs: [[8, 3]] }],
	["a bitset that is not base64", { bitset: "!!!" }],
	["a bitset with a bit past the library", { bitset: "AIA=" }],
] as const) {
	test(`${why} is a malformed answer, which the asker reads as an answer that failed and not as none`, async (t) => {
		answering(t, albumAt(refs));
		const result = await askAlbum();
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.reason, "failed");
	});
}

test("an ordinal in best past the library is a malformed answer", async (t) => {
	answering(t, {
		structure: LIBRARY.structure,
		revision: 1,
		matched: null,
		matchCount: 0,
		best: [400099],
		artists: { total: 0, top: [] },
		albums: { total: 0, top: [] },
		genres: { total: 0, top: [] },
		namesATrack: false,
	});
	const result = await fetchLibraryAnswer(
		ORIGIN,
		{ kind: "search", query: "a", limit: 8, splitsCredits: true },
		LIBRARY_ROLES,
		LIBRARY,
	);
	assert.equal(result.ok, false);
});

test("an answer counted at another structure may name ordinals past the library held, and is returned for the asker to drop", async (t) => {
	answering(t, albumAt({ runs: [[8, 3]] }, LIBRARY.structure + 1));
	const result = await askAlbum();
	assert.equal(result.ok, true);
});
