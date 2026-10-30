import assert from "node:assert/strict";
import test from "node:test";
import { namesAnArtist } from "../../src/domain/track/fields.ts";

test("Various Artists is nowhere you can go, wherever it is asked", () => {
	assert.equal(namesAnArtist("Various Artists"), false);
	assert.equal(namesAnArtist("  VA "), false);
	assert.equal(namesAnArtist(""), false);
	assert.equal(namesAnArtist(null), false);
	assert.equal(namesAnArtist("Blood, Sweat & Tears"), true);
});
