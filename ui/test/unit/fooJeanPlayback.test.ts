import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { createFooJeanServer } from "../fake-api/agentServer.ts";
import { createState } from "../fake-api/state.ts";

const PLAYING_AT_SECONDS = 30;

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

const playingMidPlaylist = (
	volume?: Partial<ReturnType<typeof createState>["player"]["volume"]>,
) => {
	const fresh = createState({ fooJean: {} });
	if (volume) fresh.player.volume = { ...fresh.player.volume, ...volume };

	const playlist = fresh.playlists.find((one) => one.items.length >= 3);
	assert.ok(playlist, "the fixture holds no playlist with a row either side");
	fresh.playItem(playlist.id, 1);
	fresh.patchPlayer({ position: PLAYING_AT_SECONDS });
	return fresh;
};

beforeEach(() => {
	state = playingMidPlaylist();
});

const post = (path: string, body?: string) =>
	fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body }),
	});

const assertRefused = async (path: string, body: string, error: string) => {
	const before = structuredClone(state.player);

	const answer = await post(path, body);

	assert.equal(answer.status, 400, body);
	assert.equal((await answer.json()).error, error, body);
	assert.deepEqual(state.player, before, `${body} still reached the player`);
};

test("a level at either end of the player's own range is taken", async () => {
	const { min, max } = state.player.volume;

	for (const value of [min, max]) {
		const answer = await post("/api/volume", JSON.stringify({ value }));

		assert.equal(answer.status, 204, `value ${value}`);
		assert.equal(state.player.volume.value, value);
	}
});

test("a level past either end of the player's own range is refused, not clamped", async () => {
	const { min, max } = state.player.volume;

	for (const value of [min - 0.5, max + 0.5])
		await assertRefused(
			"/api/volume",
			JSON.stringify({ value }),
			"unacceptable volume",
		);
});

// The range is the player's, so a literal -100 floor would take a level this player cannot hold.
test("a player ranged -50 to 0 takes its own floor and refuses -60", async () => {
	state = playingMidPlaylist({ min: -50, max: 0, value: -20 });

	await assertRefused(
		"/api/volume",
		JSON.stringify({ value: -60 }),
		"unacceptable volume",
	);

	const floor = await post("/api/volume", JSON.stringify({ value: -50 }));
	assert.equal(floor.status, 204);
	assert.equal(state.player.volume.value, -50);
});

test("a seek to a negative position is refused", async () => {
	await assertRefused(
		"/api/playback/seek",
		JSON.stringify({ seconds: -1 }),
		"unacceptable seek",
	);
});

test("a seek to the start and a seek backward are both taken", async () => {
	const start = await post(
		"/api/playback/seek",
		JSON.stringify({ seconds: 0 }),
	);
	assert.equal(start.status, 204);
	assert.equal(state.player.activeItem.position, 0);

	state = playingMidPlaylist();
	const back = await post(
		"/api/playback/seek",
		JSON.stringify({ relativeSeconds: -10 }),
	);
	assert.equal(back.status, 204);
	assert.equal(state.player.activeItem.position, PLAYING_AT_SECONDS - 10);
});

// Written raw because `JSON.stringify` has no way to spell a number past a double's range, and
// `JSON.parse` reads this one as Infinity where the component's parser refuses it outright.
test("a number too large to hold is refused on every numeric field", async () => {
	const cases = [
		["/api/playback/seek", '{"seconds": 1e999}', "unacceptable seek"],
		["/api/playback/seek", '{"relativeSeconds": -1e999}', "unacceptable seek"],
		["/api/volume", '{"value": 1e999}', "unacceptable volume"],
	] as const;

	for (const [path, body, error] of cases)
		await assertRefused(path, body, error);
});

test("a body sent to a transport command is ignored and the command still runs", async () => {
	for (const command of ["play-pause", "next", "previous", "stop"]) {
		const path = `/api/playback/${command}`;

		state = playingMidPlaylist();
		const untouched = structuredClone(state.player);
		assert.equal((await post(path)).status, 204, `${command} with no body`);
		const withoutBody = structuredClone(state.player);
		assert.notDeepEqual(withoutBody, untouched, `${command} did nothing`);

		state = playingMidPlaylist();
		const withBody = await post(path, JSON.stringify({ seconds: 5 }));

		assert.equal(withBody.status, 204, `${command} with a body`);
		assert.deepEqual(
			state.player,
			withoutBody,
			`${command} with a body left the player somewhere the bare command does not`,
		);
	}
});
