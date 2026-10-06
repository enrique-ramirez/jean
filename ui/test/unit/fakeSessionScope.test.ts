import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertConforms,
	DETACHED_ORDERS,
	eventually,
	fakePlayer,
	guidOf,
	NO_SUCH_SESSION,
	pathAt,
	type Scope,
	titleAt,
} from "./fakeSessionHarness.ts";

const fake = fakePlayer();
const { send, fresh, create, poll, playRow, playerAsSeen } = fake;

const heardSession = async (fooJean = {}) => {
	const state = fresh(fooJean);
	const session = await create("device-a");
	state.addSessionListener(session, { deviceId: "device-a", name: "Phone" });
	return { state, session, scope: { session, deviceId: "device-a" } as Scope };
};

const queueOf = async (scope: Scope = {}) => {
	const answer = await send("GET", "/queue", scope);
	assert.equal(answer.status, 200, answer.text);
	return answer.body;
};

const titlesQueued = async (scope: Scope) =>
	(await queueOf(scope)).entries.map((entry: { title: string }) => entry.title);

test("a poll naming a session answers that session under player, and the player's output, playlists and library beside it", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 2);
	const player = await send("GET", "/state");

	const answer = await send("GET", "/state", scope);

	assert.equal(answer.status, 200);
	assertConforms("getState", 200, answer.body);
	const own = answer.body.player;
	assert.equal(own.path, pathAt(state, "p5", 2));
	assert.equal(own.title, titleAt(state, "p5", 2));
	assert.equal(own.playback, "playing");
	assert.equal(own.playingLocation, null);
	for (const field of [
		"volume",
		"muted",
		"outputDeviceId",
		"outputSilent",
		"currentPlaylistId",
		"playlistsRevision",
	])
		assert.deepEqual(own[field], player.body.player[field], field);
	for (const section of ["library", "configGeneration", "mainThread"])
		assert.deepEqual(answer.body[section], player.body[section], section);
});

test("naming no session, an empty one or engine acts on the player and leaves the session where it was", async () => {
	const { state, session, scope } = await heardSession();
	await playRow(scope, "p5", 0);
	state.playItem("p7", 0);

	for (const [step, named] of [undefined, "", "engine"].entries()) {
		const answer = await send("POST", "/playback/next", {
			session: named,
			deviceId: "device-a",
		});
		assert.equal(answer.status, 204, String(named));
		assert.equal(
			(await poll()).path,
			pathAt(state, "p7", 1 + step),
			String(named),
		);

		const read = await poll({ session: named, deviceId: "device-a" });
		const unnamed = await poll();
		assert.equal(read.path, unnamed.path, String(named));
		assert.equal(read.playingLocation?.index, unnamed.playingLocation?.index);
	}

	assert.equal(
		(await poll({ session, deviceId: "device-a" })).path,
		pathAt(state, "p5", 0),
	);
});

test("a row played in a session plays there and leaves the player and every playlist where they were", async () => {
	const { state, scope } = await heardSession();
	const before = await playerAsSeen();

	assert.equal((await playRow(scope, "p5", 2)).status, 204);

	assert.equal((await poll(scope)).path, pathAt(state, "p5", 2));
	assert.deepEqual(await playerAsSeen(), before);
});

test("a library set played in a session starts at its index in the order sent, and writes no playlist", async () => {
	const { state, scope } = await heardSession();
	const before = await playerAsSeen();
	const ordinals = [5, 0, 3];

	const answer = await send("POST", "/playback/play", {
		...scope,
		body: { structure: await fake.structure(), ordinals, index: 1 },
	});

	assert.equal(answer.status, 204, answer.text);
	const started = state.ordinalOrder()[ordinals[1]].track["%path%"];
	assert.equal((await poll(scope)).path, started);
	assert.deepEqual(await playerAsSeen(), before);
});

test("the player's own session plays no library set, and refuses it as playback control says", async () => {
	for (const canControlPlayback of [true, false]) {
		fresh({ canControlPlayback });
		const before = await playerAsSeen();
		const body = { structure: await fake.structure(), ordinals: [0], index: 0 };

		for (const session of [undefined, "engine"]) {
			const answer = await send("POST", "/playback/play", { session, body });
			if (canControlPlayback) {
				assert.equal(answer.status, 409, String(session));
				assert.deepEqual(answer.body, {
					error:
						"the engine session plays a playlist row; name a detached session",
				});
			} else assert.equal(answer.status, 403, String(session));
		}
		assert.deepEqual(await playerAsSeen(), before);
	}
});

test("next, previous, stop and play-pause move the session alone", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 1);
	const before = await playerAsSeen();
	const command = async (name: string) =>
		assert.equal(
			(await send("POST", `/playback/${name}`, scope)).status,
			204,
			name,
		);

	await command("next");
	assert.equal((await poll(scope)).path, pathAt(state, "p5", 2), "next");

	await command("previous");
	assert.equal((await poll(scope)).path, pathAt(state, "p5", 1), "previous");

	await command("stop");
	const stopped = await poll(scope);
	assert.deepEqual([stopped.playback, stopped.path], ["stopped", ""], "stop");

	await command("play-pause");
	const resumed = await poll(scope);
	assert.deepEqual(
		[resumed.playback, resumed.path],
		["playing", pathAt(state, "p5", 1)],
		"play after a stop starts the row it stopped on",
	);

	await command("play-pause");
	assert.equal(
		(await poll(scope)).playback,
		"paused",
		"play-pause while playing",
	);

	assert.deepEqual(await playerAsSeen(), before);
});

test("previous more than three seconds into a session's track starts that track again, and goes back otherwise", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 2);
	await send("POST", "/playback/seek", { ...scope, body: { seconds: 4 } });

	await send("POST", "/playback/previous", scope);
	const restarted = await poll(scope);
	assert.equal(restarted.path, pathAt(state, "p5", 2));
	assert.equal(restarted.position.seconds, 0);

	await send("POST", "/playback/previous", scope);
	assert.equal((await poll(scope)).path, pathAt(state, "p5", 1));
});

test("a seek in a session moves its position alone", async () => {
	const { scope } = await heardSession();
	await playRow(scope, "p5", 2);
	const before = await playerAsSeen();

	await send("POST", "/playback/seek", { ...scope, body: { seconds: 42 } });
	assert.equal((await poll(scope)).position.seconds, 42);

	await send("POST", "/playback/seek", {
		...scope,
		body: { relativeSeconds: -2 },
	});
	assert.equal((await poll(scope)).position.seconds, 40);

	assert.deepEqual(await playerAsSeen(), before);
});

test("a session takes the five orders it offers and refuses the other two whatever the install offers", async () => {
	const { scope } = await heardSession();
	const offered = (await send("GET", "/capabilities")).body.playbackModes;
	assert.ok(
		offered.includes("shuffleAlbums") && offered.includes("shuffleFolders"),
	);
	const before = await playerAsSeen();

	for (const mode of [...DETACHED_ORDERS].reverse()) {
		const answer = await send("POST", "/playback/mode", {
			...scope,
			body: { mode },
		});
		assert.equal(answer.status, 204, mode);
		assert.equal((await poll(scope)).playbackMode, mode);
	}

	for (const mode of ["shuffleAlbums", "shuffleFolders"]) {
		const answer = await send("POST", "/playback/mode", {
			...scope,
			body: { mode },
		});
		assert.equal(answer.status, 409, mode);
		assert.deepEqual(answer.body, {
			error: "this install does not offer that playback mode",
		});
	}
	assert.equal((await poll(scope)).playbackMode, "inOrder");
	assert.deepEqual(await playerAsSeen(), before);
});

test("a session's queue is read and edited at its own revision, and the player's is untouched", async () => {
	const { state, scope } = await heardSession();
	await send("POST", "/queue", {
		body: { playlistId: guidOf(state, "p2"), positions: [0] },
	});
	const before = await playerAsSeen();

	const empty = await queueOf(scope);
	assert.deepEqual(empty.entries, []);
	assert.equal((await poll(scope)).queueRevision, empty.revision);

	const rows = await send("POST", "/queue", {
		...scope,
		body: { playlistId: guidOf(state, "p5"), positions: [3, 0] },
	});
	assert.equal(rows.status, 204, rows.text);
	const tracks = await send("POST", "/queue", {
		...scope,
		body: { structure: await fake.structure(), ordinals: [2] },
	});
	assert.equal(tracks.status, 204, tracks.text);

	const queued = await queueOf(scope);
	assertConforms("getQueue", 200, queued);
	assert.deepEqual(
		queued.entries.map((entry: { title: string }) => entry.title),
		[
			titleAt(state, "p5", 3),
			titleAt(state, "p5", 0),
			String(state.ordinalOrder()[2].track["%title%"]),
		],
	);
	assert.ok(
		queued.entries.every(
			(entry: { location: unknown }) => entry.location === null,
		),
	);
	assert.notEqual(queued.revision, empty.revision);
	assert.equal((await poll(scope)).queueRevision, queued.revision);

	const stale = await send("POST", "/queue/move", {
		...scope,
		body: { from: 2, to: 0, revision: empty.revision },
	});
	assert.equal(stale.status, 409);

	await send("POST", "/queue/move", {
		...scope,
		body: { from: 2, to: 0, revision: queued.revision },
	});
	const moved = await queueOf(scope);
	assert.equal(moved.entries[0].title, queued.entries[2].title);

	await send("DELETE", "/queue/1", {
		...scope,
		query: { revision: String(moved.revision) },
	});
	assert.deepEqual(await titlesQueued(scope), [
		moved.entries[0].title,
		moved.entries[2].title,
	]);

	assert.equal((await send("DELETE", "/queue", scope)).status, 204);
	assert.deepEqual(await titlesQueued(scope), []);

	assert.deepEqual(await playerAsSeen(), before);
});

test("next in a session plays its queued track first, then goes on from the row after the one it left", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 0);
	await send("POST", "/queue", {
		...scope,
		body: { playlistId: guidOf(state, "p2"), positions: [1] },
	});

	await send("POST", "/playback/next", scope);
	assert.equal((await poll(scope)).path, pathAt(state, "p2", 1));
	assert.deepEqual(await titlesQueued(scope), []);

	await send("POST", "/playback/next", scope);
	assert.equal((await poll(scope)).path, pathAt(state, "p5", 1));
});

test("the playing track and its cover answer for the session named", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 0);
	const columns = { columns: "%title%" };

	const own = await send("GET", "/track/playing", { ...scope, query: columns });
	assert.equal(own.status, 200);
	assert.deepEqual(
		[own.body.path, own.body.columns],
		[pathAt(state, "p5", 0), [titleAt(state, "p5", 0)]],
	);
	assert.equal(
		(await send("GET", "/track/playing", { query: columns })).body.path,
		pathAt(state, "p1", 1),
	);

	const cover = await send("GET", "/artwork/playing", scope);
	const players = await send("GET", "/artwork/playing");
	assert.deepEqual([cover.status, players.status], [200, 200]);
	assert.notEqual(cover.headers.get("etag"), players.headers.get("etag"));

	const stopped = { session: await create("device-a"), deviceId: "device-a" };
	const nothing = await send("GET", "/track/playing", {
		...stopped,
		query: columns,
	});
	assert.equal(nothing.status, 404);
	assert.deepEqual(nothing.body, { error: "nothing is playing" });
	const noCover = await send("GET", "/artwork/playing", stopped);
	assert.equal(noCover.status, 404);
	assert.deepEqual(noCover.body, { error: "no artwork for that track" });

	await playRow(stopped, "p2", 0);
	const unheard = await send("GET", "/track/playing", {
		...stopped,
		query: columns,
	});
	assert.equal(unheard.status, 200);
	assert.equal(unheard.body.path, pathAt(state, "p2", 0));
});

test("a ticket opens the stream of the session it names, and that listener is the session's alone", async () => {
	fresh();
	const session = await create("device-b");
	const scope = { session, deviceId: "device-b" };
	const ticket = await send("POST", "/stream/ticket", {
		session,
		body: { deviceId: "device-b", name: "Laptop" },
	});
	assert.equal(ticket.status, 200);

	const hangUp = new AbortController();
	const stream = await fake.openStream(ticket.body.ticket, hangUp.signal);
	try {
		assert.equal(stream.status, 200);
		assert.equal(
			(await fake.documentOf(session, "device-b")).body.listeners,
			1,
		);
		const roster = await send("GET", "/stream/listeners", scope);
		assert.deepEqual(
			roster.body.devices.map((one: { deviceId: string; name: string }) => [
				one.deviceId,
				one.name,
			]),
			[["device-b", "Laptop"]],
		);
		const players = await send("GET", "/stream/listeners");
		assert.deepEqual(players.body.devices, []);
		assert.equal(players.body.playerMuted, false);
	} finally {
		hangUp.abort();
	}

	await eventually(
		async () =>
			(await fake.documentOf(session, "device-b")).body.listeners === 0,
		"saw the session's listener hang up",
	);
});

test("the timeline naming a session carries that session's marks and none of the player's", async () => {
	const { state, scope } = await heardSession();
	const empty = await send("GET", "/stream/timeline", scope);
	assert.equal(empty.status, 200);
	assert.deepEqual(empty.body.marks, []);

	await playRow(scope, "p5", 2);

	const own = await send("GET", "/stream/timeline", scope);
	assertConforms("getStreamTimeline", 200, own.body);
	const paths = own.body.marks.map((mark: { path: string }) => mark.path);
	assert.deepEqual(paths, [pathAt(state, "p5", 2)]);

	const players = await send("GET", "/stream/timeline");
	assert.equal(players.body.marks.at(-1).path, pathAt(state, "p1", 1));
});

test("every route taking a session says no such session, in one set of bytes, to anybody that session is hidden from", async () => {
	fresh();
	const hidden = await create("device-a");
	const askers: [string, Scope][] = [
		["an id nobody issued", { session: "never-issued", deviceId: "device-a" }],
		[
			"a stranger to a private session",
			{ session: hidden, deviceId: "device-b" },
		],
		["no device, to a private session", { session: hidden }],
	];

	let bytes: string | null = null;
	for (const { id, example } of await fake.examples())
		for (const [who, scope] of askers) {
			// A leave with no device is refused for its body, which the contract does not order against the session.
			if (id === "leaveStream" && scope.deviceId === undefined) continue;
			const answer = await fake.sendExample(id, example, scope);
			assert.equal(answer.status, 404, `${id}, ${who}`);
			assert.deepEqual(answer.body, NO_SUCH_SESSION, `${id}, ${who}`);
			bytes ??= answer.text;
			assert.equal(answer.text, bytes, `${id}, ${who}`);
		}

	assert.equal(
		(await fake.documentOf(hidden, "device-a")).status,
		200,
		"a refusal ended it",
	);
});

test("with playback control off every route naming a detached session is still served", async () => {
	const { scope } = await heardSession({ canControlPlayback: false });
	await playRow(scope, "p5", 0);

	for (const { id, example } of await fake.examples()) {
		const answer = await fake.sendExample(id, example, scope);
		assert.notEqual(answer.status, 403, `${id} answered ${answer.text}`);
	}
	assert.equal(
		(await send("POST", "/playback/next")).status,
		403,
		"the player's own stays refused",
	);
});

test("the player's own routes read no session, even one nobody issued", async () => {
	const state = fresh();
	const named = { session: "never-issued", deviceId: "device-a" };

	const volume = await send("POST", "/volume", {
		...named,
		body: { value: -12 },
	});
	assert.equal(volume.status, 204);
	assert.equal(state.player.volume.value, -12);
	assert.equal((await send("GET", "/outputs", named)).status, 200);
	assert.equal((await send("DELETE", "/stream/hold", named)).status, 204);
});

test("two sessions keep their own track, position, order and queue", async () => {
	const { state, scope: first } = await heardSession();
	const second = { session: await create("device-b"), deviceId: "device-b" };
	state.addSessionListener(String(second.session), {
		deviceId: "device-b",
		name: null,
	});

	await playRow(first, "p5", 1);
	await playRow(second, "p2", 4);
	await send("POST", "/playback/seek", { ...first, body: { seconds: 12 } });
	await send("POST", "/playback/mode", {
		...second,
		body: { mode: "repeatOne" },
	});
	await send("POST", "/queue", {
		...first,
		body: { playlistId: guidOf(state, "p5"), positions: [5] },
	});

	const one = await poll(first);
	const two = await poll(second);
	assert.deepEqual(
		[one.path, one.position.seconds, one.playbackMode],
		[pathAt(state, "p5", 1), 12, "inOrder"],
	);
	assert.deepEqual(
		[two.path, two.position.seconds, two.playbackMode],
		[pathAt(state, "p2", 4), 0, "repeatOne"],
	);
	assert.deepEqual(await titlesQueued(first), [titleAt(state, "p5", 5)]);
	assert.deepEqual(await titlesQueued(second), []);
});

// A client that keys a queue on its revision alone carries one session's queue into another.
test("two new sessions given one track each answer one queue revision and two different queues", async () => {
	const state = fresh();
	const first = { session: await create("device-a"), deviceId: "device-a" };
	const second = { session: await create("device-a"), deviceId: "device-a" };

	await send("POST", "/queue", {
		...first,
		body: { playlistId: guidOf(state, "p5"), positions: [0] },
	});
	await send("POST", "/queue", {
		...second,
		body: { playlistId: guidOf(state, "p2"), positions: [0] },
	});

	const one = await queueOf(first);
	const two = await queueOf(second);
	assert.equal(one.revision, two.revision);
	assert.notDeepEqual(one.entries, two.entries);
});

test("a change in one session leaves every other session's poll and the player's answering not modified", async () => {
	const { scope: first } = await heardSession();
	const second = { session: await create("device-a"), deviceId: "device-a" };
	await playRow(first, "p5", 0);
	const tagOf = async (scope: Scope) =>
		String((await send("GET", "/state", scope)).headers.get("etag"));
	const held = { second: await tagOf(second), player: await tagOf({}) };

	await send("POST", "/playback/next", first);

	const again = (scope: Scope, tag: string) =>
		send("GET", "/state", { ...scope, headers: { "If-None-Match": tag } });
	assert.equal(
		(await again(second, held.second)).status,
		304,
		"the other session",
	);
	assert.equal((await again({}, held.player)).status, 304, "the player");
});

test("strict mode is off by default, and a route naming no session reaches the player", async () => {
	fresh();

	for (const { id, example } of await fake.examples()) {
		const answer = await fake.sendExample(id, example, {
			deviceId: "device-a",
		});
		assert.notEqual(answer.status, 500, `${id} answered ${answer.text}`);
	}
});

test("in strict mode a session-scoped route naming no session answers 500 naming the route, and reaches nothing", async () => {
	const state = fresh();
	const before = await playerAsSeen();
	const examples = await fake.examples();
	state.fooJean.strictSessions = true;

	for (const { id, example } of examples) {
		const answer = await fake.sendExample(id, example, {
			deviceId: "device-a",
		});
		assert.equal(answer.status, 500, id);
		assert.ok(
			answer.text.includes(`/api${example.path}`),
			`${id} answered ${answer.text}`,
		);
	}

	state.fooJean.strictSessions = false;
	assert.deepEqual(await playerAsSeen(), before);
});

test("in strict mode a request naming a session is served", async () => {
	const { state, scope } = await heardSession();
	await playRow(scope, "p5", 0);
	const examples = await fake.examples();
	state.fooJean.strictSessions = true;

	for (const { id, example } of examples) {
		const answer = await fake.sendExample(id, example, scope);
		assert.notEqual(answer.status, 500, `${id} answered ${answer.text}`);
	}
});

test("strict mode answers every route that takes no session the way it does with strict mode off", async () => {
	const state = fresh({ maxSessions: 8 });
	const session = await create("device-a");
	const routes: [string, string, unknown?][] = [
		["GET", "/status"],
		["GET", "/capabilities"],
		["GET", "/playlists"],
		["GET", "/outputs"],
		["POST", "/volume", { step: "down" }],
		["GET", "/sessions"],
		["GET", `/sessions/${session}`],
		["POST", "/sessions", { deviceId: "device-b" }],
	];
	const statuses = async () => {
		const answered: number[] = [];
		for (const [method, path, body] of routes)
			answered.push(
				(await send(method, path, { deviceId: "device-a", body })).status,
			);
		return answered;
	};

	const relaxed = await statuses();
	state.fooJean.strictSessions = true;
	assert.deepEqual(await statuses(), relaxed);
});
