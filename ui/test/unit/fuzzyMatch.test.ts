import assert from "node:assert/strict";
import test from "node:test";

import { fuzzyKey, fuzzyScore, squash } from "../../src/shared/lib/text.ts";

const GENRES = [
	"Heavy Metal",
	"Power Metal",
	"Progressive Metal",
	"Rock",
	"Rock En Español",
	"Indie Rock",
	"Hip-Hop",
	"Video Game Music",
	"Drum & Bass",
];

const keys = new Map(GENRES.map((name) => [name, fuzzyKey(name)]));

const ranked = (query: string) => {
	const squashed = squash(query);
	return GENRES.map((name) => ({
		name,
		score: fuzzyScore(keys.get(name) as ReturnType<typeof fuzzyKey>, squashed),
	}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.name);
};

test("separators and case are not part of the name", () => {
	assert.equal(squash("Heavy Metal"), "heavymetal");
	assert.equal(squash("heavy-metal"), "heavymetal");
	assert.equal(squash("HEAVY   METAL"), "heavymetal");
	assert.equal(squash("Hip-Hop"), "hiphop");
	assert.equal(squash("Drum & Bass"), "drumbass");
});

test("an accented tag is found from an unaccented query", () => {
	assert.equal(ranked("rock en espanol")[0], "Rock En Español");
});

test("all four spellings of one genre reach it first", () => {
	for (const spelling of [
		"Heavy Metal",
		"heavy metal",
		"heavymetal",
		"heavy-metal",
	]) {
		assert.equal(ranked(spelling)[0], "Heavy Metal", spelling);
	}
});

test("a typo still finds the genre", () => {
	assert.equal(ranked("heavy metl")[0], "Heavy Metal");
	assert.equal(ranked("progresive metal")[0], "Progressive Metal");
});

test("a dropped letter is forgiven in a short query too, as a subsequence", () => {
	assert.equal(ranked("rok")[0], "Rock");
});

test("two characters do not match anything they merely appear in", () => {
	// `mt` is in `Heavy Metal` in order, and matching on that would rank the whole library.
	assert.equal(ranked("mt").length, 0);
});

test("the exact name outranks the names containing it", () => {
	assert.equal(ranked("rock")[0], "Rock");
	assert.equal(ranked("metal")[0], "Heavy Metal");
});

test("a word anywhere in the name is found, not only the first", () => {
	assert.ok(ranked("metal").includes("Progressive Metal"));
	assert.ok(ranked("game").includes("Video Game Music"));
});

test("an exact match beats a prefix match of the same length", () => {
	const rock = fuzzyScore(fuzzyKey("Rock"), "rock");
	const rocken = fuzzyScore(fuzzyKey("Rock En Español"), "rock");
	assert.ok(rock > rocken);
});

test("an empty query keeps every candidate", () => {
	assert.equal(ranked("").length, GENRES.length);
});

test("a query nothing answers scores nothing", () => {
	assert.deepEqual(ranked("zzzzqqqq"), []);
});
