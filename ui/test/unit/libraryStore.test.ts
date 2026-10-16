import assert from "node:assert/strict";
import test from "node:test";

import {
	reloadPlan,
	type StoredLibrary,
	type StoreKey,
} from "../../src/domain/track/libraryStore.ts";

const KEY: StoreKey = {
	declaration: ["%title%", "%artist%", "%lastfm_play_count%"],
	format: 3,
	apiVersion: 1,
	build: "build-a",
};

const STORED: StoredLibrary = {
	key: KEY,
	snapshotId: "9f3c2a71b5d04e68",
	trackCount: 30441,
	structure: 1000016777216,
	revision: 903,
};

const NOW_SAME_LIBRARY = {
	snapshotId: "9f3c2a71b5d04e68",
	trackCount: 30441,
	structure: 1000033554432,
	revision: 1,
};

test("nothing stored is an export", () => {
	assert.deepEqual(reloadPlan(null, KEY, NOW_SAME_LIBRARY), { kind: "export" });
});

test("the copy at the very pair the player answers, with the same snapshotId and trackCount, is drawn as it is", () => {
	const now = {
		snapshotId: STORED.snapshotId,
		trackCount: STORED.trackCount,
		structure: STORED.structure,
		revision: STORED.revision,
	};
	assert.deepEqual(reloadPlan(STORED, KEY, now), {
		kind: "draw",
		structure: STORED.structure,
		revision: STORED.revision,
	});
});

test("the same snapshotId and trackCount at another structure ask for the changes from the pair the copy was stored at", () => {
	assert.deepEqual(reloadPlan(STORED, KEY, NOW_SAME_LIBRARY), {
		kind: "delta",
		structure: STORED.structure,
		since: STORED.revision,
	});
});

test("the same snapshotId and trackCount at another structure and the stored revision ask for the changes from the stored pair", () => {
	const now = { ...NOW_SAME_LIBRARY, revision: STORED.revision };
	assert.deepEqual(reloadPlan(STORED, KEY, now), {
		kind: "delta",
		structure: STORED.structure,
		since: STORED.revision,
	});
});

test("the same snapshotId and trackCount at another revision of the same structure ask for the changes from the stored pair", () => {
	const now = {
		...NOW_SAME_LIBRARY,
		structure: STORED.structure,
		revision: STORED.revision + 4,
	};
	assert.deepEqual(reloadPlan(STORED, KEY, now), {
		kind: "delta",
		structure: STORED.structure,
		since: STORED.revision,
	});
});

test("a different snapshotId asks for the changes from the pair the copy was stored at", () => {
	const now = {
		snapshotId: "0b7d11e09ac35f42",
		trackCount: 30441,
		structure: STORED.structure,
		revision: 911,
	};
	assert.deepEqual(reloadPlan(STORED, KEY, now), {
		kind: "delta",
		structure: STORED.structure,
		since: STORED.revision,
	});
});

test("the same snapshotId over another trackCount is not the stored library, so it asks for the changes", () => {
	const now = { ...NOW_SAME_LIBRARY, trackCount: STORED.trackCount + 1 };
	assert.deepEqual(reloadPlan(STORED, KEY, now), {
		kind: "delta",
		structure: STORED.structure,
		since: STORED.revision,
	});
});

const KEYS_CHANGED_ALONE: { what: string; key: StoreKey }[] = [
	{
		what: "a column added to the declaration",
		key: { ...KEY, declaration: [...KEY.declaration, "%genre%"] },
	},
	{
		what: "a column of the declaration replaced",
		key: {
			...KEY,
			declaration: ["%title%", "%artist%", "%play_count%"],
		},
	},
	{ what: "another JLIB format", key: { ...KEY, format: KEY.format + 1 } },
	{
		what: "another apiVersion",
		key: { ...KEY, apiVersion: KEY.apiVersion + 1 },
	},
	{ what: "another build of Jean", key: { ...KEY, build: "build-b" } },
];

for (const { what, key } of KEYS_CHANGED_ALONE)
	test(`${what} exports, even where the snapshotId matches`, () => {
		assert.deepEqual(reloadPlan(STORED, key, NOW_SAME_LIBRARY), {
			kind: "export",
		});
	});
