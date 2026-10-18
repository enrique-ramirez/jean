import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { loadComponentLibrary } from "../../src/domain/track/libraryLoader.ts";
import { playlistSnapshot } from "../../src/domain/track/playlistEntries.ts";
import { generatedRows, searchLibraryOf, seeded } from "./searchLibraries.ts";
import { installStubWorker } from "./stubWorker.ts";

installStubWorker();

const ORIGIN = "http://landing.invalid:8881";
const KEY = "jean.fieldAvailability";
const UNRESOLVED = "?";

const turn = () => new Promise((resolve) => setImmediate(resolve));

function playerServing(exported: ArrayBuffer) {
	globalThis.fetch = ((request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/api/library/export")
			return Promise.resolve(new Response(exported.slice(0)));
		return Promise.reject(new TypeError("fetch failed"));
	}) as typeof fetch;
}

function storage() {
	const items = new Map<string, string>();
	const held = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		value: {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => items.set(key, String(value)),
			removeItem: (key: string) => items.delete(key),
		},
		configurable: true,
		writable: true,
	});
	return {
		items,
		restore: () => {
			if (held) Object.defineProperty(globalThis, "localStorage", held);
			else delete (globalThis as { localStorage?: unknown }).localStorage;
		},
	};
}

test("a landed library stores which fields it resolves: one unresolved on every track is left out, and the rest are named", async (t) => {
	const realFetch = globalThis.fetch;
	const stored = storage();
	t.after(() => {
		globalThis.fetch = realFetch;
		stored.restore();
	});

	const rows = generatedRows(seeded(1), 40);
	for (const row of rows) row[FIELD.year] = UNRESOLVED;
	playerServing(searchLibraryOf(rows).exported());

	const key = loadComponentLibrary(ORIGIN);
	const isDrawn = () =>
		playlistSnapshot(key).columns.trackCount === rows.length &&
		!playlistSnapshot(key).isLoading;
	for (let at = 0; at < 500 && !isDrawn(); at += 1) await turn();
	assert.ok(isDrawn(), "the library was never drawn");

	const names = JSON.parse(stored.items.get(KEY) ?? "null") as unknown;
	assert.ok(Array.isArray(names), `nothing stored under ${KEY}`);
	assert.equal(names.includes(TRACK_EXPRESSIONS[FIELD.year]), false);
	assert.equal(names.includes(TRACK_EXPRESSIONS[FIELD.title]), true);
	assert.equal(names.includes(TRACK_EXPRESSIONS[FIELD.genre]), true);
});
