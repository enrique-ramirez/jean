import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoute, routeOfPlayingSet } from "../../src/app/routes.ts";
import {
	albumLabel,
	SCRATCH_KIND,
} from "../../src/domain/track/jeanPlaylists.ts";
import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
} from "../../src/domain/track/routes.ts";
import type { Translate } from "../../src/shared/i18n/useTranslate.ts";

test("an empty route and home are both the home screen", () => {
	for (const route of ["", "home"])
		assert.equal(resolveRoute(route).kind, "home", route);
});

test("each fixed route names only itself", () => {
	assert.equal(resolveRoute("all").kind, "all");
	assert.equal(resolveRoute("genres").kind, "genres");
	assert.deepEqual(resolveRoute("search"), { kind: "search", query: null });
	assert.equal(resolveRoute("playing").kind, "playing");
});

test("a search carries its query, decoded", () => {
	assert.deepEqual(resolveRoute(searchRoute("heavy metal")), {
		kind: "search",
		query: "heavy metal",
	});
});

test("a genre, an album and an artist carry what they name, accents included", () => {
	assert.deepEqual(resolveRoute(genreRoute("Heavy Metal")), {
		kind: "genre",
		genre: "Heavy Metal",
	});

	const album = resolveRoute(albumRoute("Babasónicos", "Jessico"));
	assert.equal(album.kind, "album");
	assert.equal(album.kind === "album" && album.album.toLowerCase(), "jessico");
	assert.equal(
		album.kind === "album" && album.artist.toLowerCase(),
		"babasónicos",
	);

	const artist = resolveRoute(artistRoute("Babasónicos"));
	assert.equal(artist.kind === "artist" && artist.artist, "Babasónicos");
});

test("an artist opens on the overview unless the route asks for the tracks", () => {
	const tabOf = (route: string) => {
		const view = resolveRoute(route);
		return view.kind === "artist" ? view.tab : null;
	};
	assert.equal(tabOf(artistRoute("Babasónicos")), "overview");
	assert.equal(tabOf(artistRoute("Babasónicos", "tracks")), "tracks");
});

test("a shelf resolves by its id, and an id no shelf has is a playlist's route", () => {
	const shelf = resolveRoute("shelf/recent");
	assert.equal(shelf.kind === "shelf" && shelf.shelf.id, "recent");
	assert.equal(resolveRoute("shelf/nope").kind, "playlist");
});

// Every route that is not one of these is a playlist's, which is how the shell
// decides what to draw.
test("a playlist's route is not the library's, and neither is one that does not decode", () => {
	for (const route of ["p7", genreRoute("x").replace("x", "%E0%A4%A")])
		assert.deepEqual(resolveRoute(route), { kind: "playlist", id: route });
});

test("an album being played has a row of its own, routed to the record's page", () => {
	const t = ((key: string) => key) as Translate;
	const playing = routeOfPlayingSet(
		{
			kind: SCRATCH_KIND.album,
			label: albumLabel("Babasónicos", "Jessico"),
			name: "Jessico",
			itemCount: 12,
			isPlaying: true,
		},
		t,
	);
	assert.equal(playing?.route, albumRoute("Babasónicos", "Jessico"));
	assert.equal(playing?.temporaryRow, true);
});
