import assert from "node:assert/strict";
import test from "node:test";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createState } from "../fake-api/state.ts";
import { ask, libraryOf } from "./fakeLibraryHarness.ts";

const builtThroughRows = async () => {
	const state = createState({
		mediaLibrary: libraryOfShape({ tracks: 12, albums: 3, artists: 2 }),
	});
	const declared = await ask(state, "/api/library/rows", {
		method: "POST",
		body: { columns: ["%title%"], structure: "0", ordinals: [0] },
	});
	assert.equal(declared.status, 202);
	const library = await libraryOf(state);
	assert.equal(library.ready, true, "the declaration was not built");
	return library;
};

test("structure is seeded per fake, so two built the same way never share one", async () => {
	const first = await builtThroughRows();
	const second = await builtThroughRows();

	for (const library of [first, second]) {
		assert.ok(
			Number.isSafeInteger(library.structure),
			String(library.structure),
		);
		assert.ok(library.structure > 0);
	}
	assert.notEqual(first.structure, second.structure);
});
