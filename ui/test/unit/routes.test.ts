import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoute } from "../../src/app/routes.ts";
import { genreRoute } from "../../src/domain/library/genreRoute.ts";
import { searchRoute } from "../../src/domain/library/searchRoute.ts";
import { albumRoute } from "../../src/domain/track/albumRoute.ts";
import { artistRoute } from "../../src/domain/track/artistRoute.ts";

test("an empty route and home are both the home screen", () => {
	for (const route of ["", "home"]) {
		const resolved = resolveRoute(route);
		assert.equal(resolved.isHome, true, route);
		assert.equal(resolved.isLibrary, true, route);
	}
});

test("each fixed route names only itself", () => {
	assert.equal(resolveRoute("all").isAll, true);
	assert.equal(resolveRoute("genres").isGenres, true);
	assert.equal(resolveRoute("search").isSearch, true);
	assert.equal(resolveRoute("all").isHome, false);
	assert.equal(resolveRoute("genres").isSearch, false);
});

test("a search carries its query, decoded", () => {
	const resolved = resolveRoute(searchRoute("heavy metal"));
	assert.equal(resolved.searchQuery, "heavy metal");
	assert.equal(resolved.isSearch, true);
});

test("a genre, an album and an artist carry what they name, accents included", () => {
	assert.equal(resolveRoute(genreRoute("Heavy Metal")).genre, "Heavy Metal");

	const album = resolveRoute(albumRoute("Babasónicos", "Jessico"));
	assert.ok(album.album);
	assert.equal(album.album.toLowerCase(), "jessico");
	assert.equal(album.albumArtist?.toLowerCase(), "babasónicos");

	assert.equal(resolveRoute(artistRoute("Babasónicos")).artist, "Babasónicos");
});

test("an artist opens on the overview unless the route asks for the tracks", () => {
	assert.equal(resolveRoute(artistRoute("Babasónicos")).artistTab, "overview");
	assert.equal(
		resolveRoute(artistRoute("Babasónicos", "tracks")).artistTab,
		"tracks",
	);
});

test("a shelf resolves by its id, and an id no shelf has is not a shelf", () => {
	assert.equal(resolveRoute("shelf/recent").shelf?.id, "recent");
	assert.equal(resolveRoute("shelf/nope").shelf, null);
	assert.equal(resolveRoute("shelf/nope").isLibrary, false);
});

// Every route that is not one of these is a playlist's, which is how the shell
// decides what to draw.
test("a playlist's route is not the library's, and neither is one that does not decode", () => {
	for (const route of ["p7", genreRoute("x").replace("x", "%E0%A4%A")]) {
		const resolved = resolveRoute(route);
		assert.equal(resolved.isLibrary, false, route);
		assert.equal(resolved.genre, null, route);
	}
});

test("the now-playing route is the library's", () => {
	assert.equal(resolveRoute("playing").isLibrary, true);
});
