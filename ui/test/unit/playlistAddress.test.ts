import assert from "node:assert/strict";
import test from "node:test";
import { playlistRowArtworkUrl } from "../../src/shared/api/artwork.ts";
import { fillPlaylist } from "../../src/shared/api/playlists.ts";

// A playlist id is the player's to choose. Every route naming one has to escape it the same way,
// or an id carrying a reserved character reaches a different path than the one it names.

const ORIGIN = "http://127.0.0.1:9";
const AWKWARD_ID = "a/b?c#d";
const ESCAPED = "a%2Fb%3Fc%23d";

test("a playlist row's cover names the playlist escaped", () => {
	assert.equal(
		playlistRowArtworkUrl(ORIGIN, AWKWARD_ID, 2),
		`${ORIGIN}/api/artwork/playlists/${ESCAPED}/2`,
	);
});

test("filling a playlist names the playlist escaped", async (t) => {
	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
	const sent: string[] = [];
	globalThis.fetch = (async (request: Request) => {
		sent.push(request.url);
		return Response.json({});
	}) as typeof fetch;

	await fillPlaylist(ORIGIN, AWKWARD_ID, { structure: 1, ordinals: [0] });

	assert.deepEqual(sent, [`${ORIGIN}/api/playlists/${ESCAPED}/items`]);
});
