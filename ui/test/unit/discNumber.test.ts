import assert from "node:assert/strict";
import test from "node:test";

import { discNumber } from "../../src/domain/track/grouping.ts";

test("a disc written plainly, padded, or with the total after a slash is the same disc", () => {
	assert.equal(discNumber("1"), 1);
	assert.equal(discNumber("01"), 1);
	assert.equal(discNumber("1/2"), 1);
	assert.equal(discNumber("2/2"), 2);
});

test("an unresolved field, an empty one or N/A is no disc", () => {
	assert.equal(discNumber(undefined), null);
	assert.equal(discNumber("?"), null);
	assert.equal(discNumber(""), null);
	assert.equal(discNumber("N/A"), null);
});

test("zero, a negative number or words are no disc", () => {
	assert.equal(discNumber("0"), null);
	assert.equal(discNumber("-1"), null);
	assert.equal(discNumber("Disc One"), null);
});
