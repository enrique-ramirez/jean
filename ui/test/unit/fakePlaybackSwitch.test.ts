import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { createServer } from "../fake-api/server.ts";
import { createState } from "../fake-api/state.ts";

// Word for word what `describe()` in the component's `core/playlists.cpp` answers.
const PLAYBACK_DISABLED = {
	error:
		"this install has playback control turned off; turn on controlPlayback in config.json to allow it",
	detail: "",
};

const server = createServer();
let origin = "";

before(async () => {
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
	server.close();
});

const playing = (canControlPlayback?: boolean) => {
	const state = server.reset(
		createState({
			fooJean: canControlPlayback === undefined ? {} : { canControlPlayback },
		}),
	);
	const playlist = state.playlists.find((one) => one.items.length >= 3);
	assert.ok(playlist, "the fixture holds no playlist with three rows");
	state.playItem(playlist.id, 1);
	return { state, playlist };
};

const send = (method: string, path: string, body?: unknown) =>
	fetch(`${origin}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

const read = async (path: string) => (await fetch(`${origin}${path}`)).json();

const canControlPlayback = async () =>
	(await read("/api/capabilities")).canControlPlayback;

const configGeneration = async () =>
	(await read("/api/state")).configGeneration;

const flip = (canControl: boolean) =>
	send("POST", "/__control/controlPlayback", { canControl });

test("playback control is on by default, reported, and a command goes through", async () => {
	playing();

	assert.equal(await canControlPlayback(), true);
	assert.equal((await send("POST", "/api/playback/play-pause")).status, 204);
});

test("with playback control off, every playback, queue and scratch write is refused with the component's 403", async () => {
	const { state, playlist } = playing(false);
	const [mode] = (await read("/api/capabilities")).playbackModes;
	const { revision } = await read("/api/queue");

	const routes: [method: string, path: string, body?: unknown][] = [
		["POST", "/api/playback/play-pause"],
		["POST", "/api/playback/pause"],
		["POST", "/api/playback/resume"],
		["POST", "/api/playback/next"],
		["POST", "/api/playback/previous"],
		["POST", "/api/playback/stop"],
		["POST", "/api/playback/seek", { seconds: 10 }],
		["POST", "/api/playback/mode", { mode }],
		["POST", "/api/volume", { step: "down" }],
		["POST", `/api/playlists/${playlist.guid}/items/2/play`],
		["POST", "/api/queue", { playlistId: playlist.guid, positions: [2] }],
		["POST", "/api/queue/move", { from: 0, to: 0, revision }],
		["DELETE", "/api/queue"],
		["DELETE", `/api/queue/0?revision=${revision}`],
		[
			"POST",
			"/api/playlists/own/scratch/items",
			{ title: "Scratch", structure: 0, ordinals: [0] },
		],
		["DELETE", "/api/playlists/own/scratch/items"],
	];

	const playerBefore = structuredClone(state.player);
	const answers = [];
	for (const [method, path, body] of routes) {
		const answer = await send(method, path, body);
		answers.push({
			route: `${method} ${path}`,
			status: answer.status,
			body: await answer.json().catch(() => null),
		});
	}

	assert.deepEqual(
		answers,
		routes.map(([method, path]) => ({
			route: `${method} ${path}`,
			status: 403,
			body: PLAYBACK_DISABLED,
		})),
	);
	assert.deepEqual(
		state.player,
		playerBefore,
		"a refused write moved the player",
	);
	assert.equal(await canControlPlayback(), false);
});

test("with playback control off, the state and the queue still answer", async () => {
	playing(false);

	assert.equal((await fetch(`${origin}/api/state`)).status, 200);
	assert.equal((await fetch(`${origin}/api/queue`)).status, 200);
});

test("the control route turns playback control off mid-test, and back on", async () => {
	playing();

	assert.equal((await flip(false)).status, 204);
	assert.equal(await canControlPlayback(), false);
	assert.equal((await send("POST", "/api/playback/play-pause")).status, 403);

	assert.equal((await flip(true)).status, 204);
	assert.equal(await canControlPlayback(), true);
	assert.equal((await send("POST", "/api/playback/play-pause")).status, 204);
});

// A client polls this to learn a switch moved without asking for capabilities
// on every tick, so a value that also moved on playback would refetch forever.
test("configGeneration moves when the switch flips, and at no other time", async () => {
	playing();

	const initial = await configGeneration();
	assert.equal(typeof initial, "number");

	await send("POST", "/api/playback/play-pause");
	await send("POST", "/api/playback/next");
	await flip(true);
	assert.equal(
		await configGeneration(),
		initial,
		"moved without the switch changing",
	);

	await flip(false);
	const off = await configGeneration();
	assert.notEqual(off, initial, "did not move when control went off");

	await flip(false);
	assert.equal(
		await configGeneration(),
		off,
		"moved on a flip that changed nothing",
	);

	await flip(true);
	assert.notEqual(
		await configGeneration(),
		off,
		"did not move when control came back on",
	);
});
