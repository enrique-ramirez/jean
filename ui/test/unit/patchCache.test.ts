import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { moved } from "../../src/shared/lib/moved.ts";
import { patchCache } from "../../src/shared/lib/patchCache.ts";

const KEY = ["list"];

interface Held {
	revision: number;
	items: string[];
}

const holding = (held: Held) => {
	const client = new QueryClient();
	client.setQueryData(KEY, held);
	return client;
};

const revisionIn = (client: QueryClient) => () =>
	client.getQueryData<Held>(KEY)?.revision;

test("a move lands the item at the index asked for, in either direction", () => {
	assert.deepEqual(moved(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
	assert.deepEqual(moved(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
	assert.deepEqual(moved(["a", "b"], 1, 1), ["a", "b"]);
});

test("a failed write puts back what it patched", () => {
	const client = holding({ revision: 1, items: ["a", "b"] });
	const written = patchCache<Held>(
		client,
		KEY,
		(held) => ({ ...held, items: [] }),
		revisionIn(client),
	);
	assert.deepEqual(client.getQueryData<Held>(KEY)?.items, []);

	written.rollBack();
	assert.deepEqual(client.getQueryData<Held>(KEY)?.items, ["a", "b"]);
});

test("a rollback stands down over a value the player has replaced since", () => {
	const client = holding({ revision: 1, items: ["a", "b"] });
	const written = patchCache<Held>(
		client,
		KEY,
		(held) => ({ ...held, items: [] }),
		revisionIn(client),
	);
	client.setQueryData<Held>(KEY, { revision: 2, items: ["c"] });

	written.rollBack();
	assert.deepEqual(client.getQueryData<Held>(KEY), {
		revision: 2,
		items: ["c"],
	});
});

test("a patch that changed nothing has nothing to roll back", () => {
	const client = holding({ revision: 1, items: ["a"] });
	const written = patchCache<Held>(client, KEY, () => null);
	client.setQueryData<Held>(KEY, { revision: 1, items: ["newer"] });

	written.rollBack();
	assert.deepEqual(client.getQueryData<Held>(KEY)?.items, ["newer"]);
});
