import assert from "node:assert/strict";
import test from "node:test";

import { completionFor } from "../../src/shared/lib/text.ts";

// The same tag written the two ways a tagger can write it. Both occur in real libraries, and
// `fold()` normalises to NFD, so only one of them has the length the query is measured in.
const NFC = "Rock en Español".normalize("NFC");
const NFD = "Rock en Español".normalize("NFD");

const ghost = (query: string, best: string) =>
	query + (completionFor(query, best) ?? "");

test("a precomposed tag completes to itself", () => {
	assert.equal(completionFor("rock", NFC), " en Español");
	assert.equal(ghost("rock en espanol", NFC), "rock en espanol");
	assert.equal(ghost("rock en españo", NFC), "rock en español");
});

test("a decomposed tag completes to itself as well", () => {
	assert.equal(
		ghost("rock en espanol", NFD).normalize("NFC"),
		"rock en espanol",
	);
	assert.equal(
		ghost("rock en españo", NFD).normalize("NFC"),
		"rock en español",
	);
	assert.equal(ghost("rock", NFD).normalize("NFC"), "rock en Español");
});

test("an unaccented query is completed by an accented tag", () => {
	assert.equal(completionFor("espan", "Español"), "ol");
	assert.equal(completionFor("españ", "Español"), "ol");
});

test("a match that is not a prefix draws no ghost", () => {
	assert.equal(completionFor("heavymetal", "Heavy Metal"), null);
	assert.equal(completionFor("metal", "Heavy Metal"), null);
});

test("an exact match has nothing left to offer", () => {
	assert.equal(completionFor("Heavy Metal", "Heavy Metal"), null);
	assert.equal(completionFor("heavy metal", "Heavy Metal"), null);
});

test("an empty query and a missing best answer nothing", () => {
	assert.equal(completionFor("", "Heavy Metal"), null);
	assert.equal(completionFor("heavy", null), null);
});
