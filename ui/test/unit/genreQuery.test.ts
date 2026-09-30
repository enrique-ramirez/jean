import assert from "node:assert/strict";
import test from "node:test";

import { genreQuery } from "../../src/domain/library/genreQuery.ts";

// `autoplaylists.spec.ts` drives the accented case through the real UI and
// stays there, because the query only matters once it reaches the player. What
// no e2e can reach is a genre tag with a quote in it: the fixture library has
// none, and the file's own comment says a query that parses and matches the
// wrong set is what neither side can catch.

test("each of the tag's values is matched whole rather than as a substring", () => {
	// HAS would collect Punk Rock and Post Rock as well, and `%genre%` would
	// compare the values joined into one string, missing a track tagged Rock and
	// Blues. Either is a different set from the one the tile counted.
	assert.equal(genreQuery("Rock"), 'genre IS "Rock"');
});

test("an accented tag goes through untouched", () => {
	assert.equal(genreQuery("Rock En Español"), 'genre IS "Rock En Español"');
});

test("a quote in the tag is doubled, which is how the player escapes one", () => {
	assert.equal(genreQuery('Rock "n" Roll'), 'genre IS "Rock ""n"" Roll"');
	assert.ok(!genreQuery('a" OR genre IS "b').includes('a" OR'));
});

test("an empty tag is a query for the empty tag, not for everything", () => {
	assert.equal(genreQuery(""), 'genre IS ""');
});
