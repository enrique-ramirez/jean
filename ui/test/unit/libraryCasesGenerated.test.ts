import assert from "node:assert/strict";
import test from "node:test";
import { caseFileDrift } from "../../scripts/libraryCases.ts";

// A case's `expected` is what the fake answers, written by `pnpm cases`, so a rule changed on
// purpose is one regeneration and a change nobody meant shows here as the cases it moved.
test("the three case files are what the generator writes from their libraries and questions today", () => {
	assert.deepEqual(caseFileDrift(), []);
});
