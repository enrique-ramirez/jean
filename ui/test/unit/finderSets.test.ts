import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { meet } from "../../src/domain/track/finderSets.ts";
import { LIBRARY_ROLES } from "../../src/domain/track/libraryAsker.ts";
import type { Refs } from "../../src/domain/track/project.ts";
import { fetchLibraryAnswer } from "../../src/shared/api/libraryQuestions.ts";

const positions = (met: Int32Array) => Array.from(met);

const bothForms = (ordinals: number[]): [string, Refs][] => [
	["a typed array", Int32Array.from(ordinals)],
	["a plain array", [...ordinals]],
];

test("in All Music every ordinal matched is a position, whichever form it came in", () => {
	for (const [form, matched] of bothForms([0, 3, 4, 5, 11]))
		assert.deepEqual(positions(meet(matched, null)), [0, 3, 4, 5, 11], form);
});

test("an empty match meets nothing, in All Music and in a list", () => {
	for (const [form, matched] of bothForms([])) {
		assert.deepEqual(positions(meet(matched, null)), [], form);
		assert.deepEqual(positions(meet(matched, [1, 2, 3])), [], form);
	}
});

test("a list's matches are the positions holding an ordinal matched, for every pairing of forms", () => {
	// The list's ordinals 3, 4 and 10 sit at positions 1, 2 and 4. Positions and ordinals differ
	// throughout, so handing back the ordinals rather than where they sit fails.
	const list = [1, 3, 4, 8, 10, 12];
	const matched = [2, 3, 4, 9, 10];
	for (const [matchedForm, matchedSet] of bothForms(matched))
		for (const [listForm, listSet] of bothForms(list))
			assert.deepEqual(
				positions(meet(matchedSet, listSet)),
				[1, 2, 4],
				`${matchedForm} matched, ${listForm} list`,
			);
});

test("a list that shares no ordinal with the match meets nothing", () => {
	assert.deepEqual(positions(meet([0, 2, 4], [1, 3, 5, 7])), []);
	assert.deepEqual(positions(meet([20, 21], [5, 6, 7])), []);
	assert.deepEqual(positions(meet([0, 1], [5, 6, 7])), []);
});

test("the first and the last position of a list are met", () => {
	assert.deepEqual(positions(meet([0, 9], [0, 4, 9])), [0, 2]);
});

test("a list ranked out of ordinal order meets in its own order, ascending by position", () => {
	// A shelf lists its tracks by rank. Its ordinals 9, 3 and 1 sit at positions 0, 1 and 3, so read in
	// ordinal order they are positions 3, 1, 0; the finder steps through the list as it is drawn.
	const shelf = [9, 3, 7, 1];
	assert.deepEqual(positions(meet([1, 3, 9], shelf)), [0, 1, 3]);
	assert.deepEqual(
		positions(meet([1, 3, 9], Int32Array.from(shelf))),
		[0, 1, 3],
	);
});

const decodedRefs = async (t: TestContext, refs: unknown) => {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (() =>
		Promise.resolve(
			Response.json({
				structure: 4,
				revision: 1,
				refs,
				album: "a",
				artist: null,
			}),
		)) as typeof fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
	const result = await fetchLibraryAnswer(
		"http://finder.invalid:8881",
		{ kind: "album", artist: null, album: "a" },
		LIBRARY_ROLES,
		{ structure: 4, trackCount: 24 },
	);
	assert.equal(result.ok, true, "the fixture's set decodes");
	if (!result.ok) throw new Error("unreachable");
	return result.answer.refs;
};

const AS_RUNS = {
	runs: [
		[2, 3],
		[9, 1],
		[17, 1],
	],
};
const AS_BITSET = {
	bitset: btoa(String.fromCharCode(0b00011100, 0b00000010, 0b00000010)),
};

test("a set foo_jean sent as runs meets as the same set sent as a bitset", async (t) => {
	const runs = await decodedRefs(t, AS_RUNS);
	const bitset = await decodedRefs(t, AS_BITSET);
	const list = [0, 3, 9, 10, 17, 23];

	assert.deepEqual(positions(meet(runs, null)), [2, 3, 4, 9, 17]);
	assert.deepEqual(positions(meet(bitset, null)), [2, 3, 4, 9, 17]);
	assert.deepEqual(positions(meet(runs, list)), [1, 2, 4]);
	assert.deepEqual(positions(meet(bitset, list)), [1, 2, 4]);
});
