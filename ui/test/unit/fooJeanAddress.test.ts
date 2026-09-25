import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { createFooJeanServer } from "../fake-api/agentServer.ts";
import { createState, libraryOfShape } from "../fake-api/state.ts";

// Pinned here rather than in a spec because no browser can reach it: Jean addresses a cue-sheet
// row by the subsong the snapshot handed it and never by 0. `test/README.md` has how the fake
// numbers them, and why it matches the player rather than counting.

const TRACKS_IN_THE_FILE = 3;

// What the fake answers for a title-formatting expression the track does not carry, as a real
// player does for an unset field.
const UNRESOLVED = "?";

let state: ReturnType<typeof createState>;
let origin = "";

const server = createFooJeanServer(
	() => state,
	() => false,
);

before(async () => {
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
	server.close();
});

beforeEach(() => {
	state = createState({
		mediaLibrary: libraryOfShape({
			tracks: TRACKS_IN_THE_FILE,
			subsongsPerFile: TRACKS_IN_THE_FILE,
		}),
		fooJean: {},
	});
	state.libraryFeed.building = ["%title%", "%rating%"];
	state.finishLibraryBuild();
});

const theFile = () => {
	const address = state.libraryPathFor(state.libraryTracks[0]);
	assert.ok(address, "the fixture library holds no addressable track");
	return address;
};

const rate = (address: Record<string, unknown>) =>
	fetch(`${origin}/api/tags`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...address, fields: { rating: "4" } }),
	});

const readRating = (track: string, subsong?: number) => {
	const query = new URLSearchParams({ track, columns: "%rating%" });
	if (subsong !== undefined) query.set("subsong", String(subsong));
	return fetch(`${origin}/api/track/library?${query}`);
};

test("a rating written to one subsong lands on that subsong and on no other", async () => {
	const track = theFile();

	const written = await rate({ track, subsong: 2 });

	assert.equal(written.status, 200);
	assert.deepEqual(await written.json(), {
		written: true,
		track,
		subsong: 2,
		fields: { rating: "4" },
	});

	for (const subsong of [1, 2, 3]) {
		const read = await readRating(track, subsong);

		assert.equal(read.status, 200, `subsong ${subsong}`);
		assert.deepEqual(
			await read.json(),
			{ columns: [subsong === 2 ? "4" : UNRESOLVED] },
			`subsong ${subsong}`,
		);
	}
});

test("a cue sheet's file holds no subsong 0, so an address naming one reaches nothing", async () => {
	const track = theFile();

	// An address naming no subsong is read as 0, which is the ordinary file's own subsong and
	// the number no track of this file carries.
	for (const address of [{ track, subsong: 0 }, { track }]) {
		const refused = await rate(address);

		assert.equal(refused.status, 404, JSON.stringify(address));
		assert.equal((await refused.json()).written, false);
	}

	assert.equal((await readRating(track, 0)).status, 404);
	assert.equal((await readRating(track)).status, 404);

	// The file's first track is what a lookup by position would have answered, so this is the
	// assertion that tells the two apart.
	const first = await readRating(track, 1);

	assert.equal(first.status, 200);
	assert.deepEqual(await first.json(), { columns: [UNRESOLVED] });
});
