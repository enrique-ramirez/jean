import assert from "node:assert/strict";
import { test } from "node:test";

import type { RecordedRequest } from "../fake-api/state.ts";
import * as requestLog from "../fake-api/state.ts";
import {
	assertConforms,
	DETACHED_ORDERS,
	fakePlayer,
	NO_SUCH_SESSION,
	pathAt,
	trackAt,
} from "./fakeSessionHarness.ts";

const fake = fakePlayer();
const {
	send,
	fresh,
	create,
	poll,
	documentOf,
	listedFor,
	share,
	leave,
	playRow,
} = fake;

const capabilities = async () => (await send("GET", "/capabilities")).body;

const assertNoSuchSession = (
	answer: { status: number; body: unknown },
	what: string,
) => {
	assert.equal(answer.status, 404, what);
	assert.deepEqual(answer.body, NO_SUCH_SESSION, what);
};

test("a new session is private, stopped and empty, and names the device that created it", async () => {
	fresh();

	const answer = await send("POST", "/sessions", {
		body: { deviceId: "device-a", name: "Kitchen tablet" },
	});

	assert.equal(answer.status, 200);
	assertConforms("createSession", 200, answer.body);
	const { id, ...rest } = answer.body;
	assert.equal(typeof id, "string");
	assert.notEqual(id, "engine");
	assert.deepEqual(rest, {
		kind: "detached",
		shared: false,
		playback: "stopped",
		title: null,
		artist: null,
		album: null,
		albumArtist: null,
		libraryPath: null,
		listeners: 0,
		playbackModes: DETACHED_ORDERS,
		chainDropped: false,
		reports: [],
		createdBy: { deviceId: "device-a", name: "Kitchen tablet" },
	});

	const player = await poll({ session: id, deviceId: "device-a" });
	assert.equal(player.playback, "stopped");
	assert.equal(player.path, "");
	const queue = await send("GET", "/queue", {
		session: id,
		deviceId: "device-a",
	});
	assert.deepEqual(queue.body.entries, []);

	assert.notEqual(
		await create("device-a"),
		id,
		"two creates answered one session",
	);
});

test("a creator that names itself nothing usable is recorded with no name", async () => {
	fresh();

	for (const body of [
		{ deviceId: "device-a" },
		{ deviceId: "device-a", name: "" },
	]) {
		const answer = await send("POST", "/sessions", { body });
		assert.equal(answer.status, 200, JSON.stringify(body));
		assert.deepEqual(answer.body.createdBy, {
			deviceId: "device-a",
			name: null,
		});
	}
});

test("a create naming no device in its body is refused, whatever the install allows", async () => {
	for (const canCreateSessions of [true, false]) {
		fresh({ canCreateSessions });

		for (const body of [{}, { deviceId: "" }, { name: "Kitchen tablet" }]) {
			const answer = await send("POST", "/sessions", { body });
			assert.equal(answer.status, 400, JSON.stringify(body));
			assert.deepEqual(answer.body, { error: "'deviceId' is required" });
		}

		const inTheQuery = await send("POST", "/sessions", {
			deviceId: "device-a",
			body: {},
		});
		assert.equal(
			inTheQuery.status,
			400,
			"a deviceId in the query counts as none",
		);
	}
});

test("the capabilities answer the cap set for the test, and that sessions can be created", async () => {
	fresh({ maxSessions: 3, canCreateSessions: true });

	const answered = await capabilities();
	assert.equal(answered.maxSessions, 3);
	assert.equal(answered.canCreateSessions, true);
});

test("where sessions cannot be created the capability reads false and a create says they are not available", async () => {
	const installs = [
		{ canCreateSessions: false, maxSessions: 4 },
		{ canCreateSessions: true, maxSessions: 0 },
		{ canCreateSessions: true, maxSessions: 4, canStream: false },
	];

	for (const install of installs) {
		fresh(install);
		const what = JSON.stringify(install);

		assert.equal((await capabilities()).canCreateSessions, false, what);
		const answer = await send("POST", "/sessions", {
			body: { deviceId: "device-a" },
		});
		assert.equal(answer.status, 503, what);
		assert.deepEqual(
			answer.body,
			{ error: "sessions are not available" },
			what,
		);
		assert.deepEqual(await listedFor("device-a"), ["engine"], what);
	}
});

test("with every place taken a create says too many sessions, and a place frees once a session ends", async () => {
	const state = fresh({ maxSessions: 2 });

	const first = await create("device-a");
	const second = await create("device-b");

	const refused = await send("POST", "/sessions", {
		body: { deviceId: "device-c" },
	});
	assert.equal(refused.status, 503);
	assert.deepEqual(refused.body, { error: "too many sessions" });
	assert.equal(
		(await capabilities()).canCreateSessions,
		true,
		"a full install still reads as able to create",
	);

	assert.equal((await leave(first, "device-a")).status, 204);
	const third = await create("device-c");

	state.endSession(second);
	await create("device-d");

	const full = await send("POST", "/sessions", {
		body: { deviceId: "device-e" },
	});
	assert.equal(full.status, 503, `${third} and the fourth hold both places`);
});

test("switching creation off mid-test refuses the next create and ends no session", async () => {
	const state = fresh();
	const id = await create("device-a");

	state.fooJean.canCreateSessions = false;

	const answer = await send("POST", "/sessions", {
		body: { deviceId: "device-b" },
	});
	assert.equal(answer.status, 503);
	assert.deepEqual(answer.body, { error: "sessions are not available" });
	assert.equal((await documentOf(id, "device-a")).status, 200);
});

test("turning streaming off refuses a create and a ticket, and ends no session", async () => {
	const state = fresh();
	const id = await create("device-a");

	state.fooJean.canStream = false;

	const created = await send("POST", "/sessions", {
		body: { deviceId: "device-b" },
	});
	assert.equal(created.status, 503);
	assert.deepEqual(created.body, { error: "sessions are not available" });
	const ticket = await send("POST", "/stream/ticket", {
		session: id,
		body: { deviceId: "device-a" },
	});
	assert.equal(ticket.status, 503);
	assert.equal((await documentOf(id, "device-a")).status, 200);
});

test("a ticket refusal set on the fake reaches a ticket naming a session", async () => {
	fresh({ failTickets: 503, ticketError: "every stream is taken" });
	const id = await create("device-a");

	const answer = await send("POST", "/stream/ticket", {
		session: id,
		body: { deviceId: "device-a" },
	});

	assert.equal(answer.status, 503);
	assert.deepEqual(answer.body, { error: "every stream is taken" });
});

test("the player's own session is listed first to every device and to none, and reads as the player", async () => {
	fresh();
	await create("device-a");
	const player = await poll();
	const { playbackModes } = await capabilities();

	for (const deviceId of ["device-a", "device-b", undefined]) {
		const answer = await send("GET", "/sessions", { deviceId });
		assert.equal(answer.status, 200);
		assertConforms("listSessions", 200, answer.body);
		const [engine] = answer.body.sessions;
		assert.deepEqual(
			{ ...engine, listeners: undefined },
			{
				id: "engine",
				kind: "engine",
				shared: true,
				playback: player.playback,
				title: player.title,
				artist: player.artist,
				album: player.album,
				albumArtist: player.albumArtist,
				libraryPath: player.libraryPath,
				listeners: undefined,
				playbackModes,
				chainDropped: false,
				reports: [],
				createdBy: null,
			},
			String(deviceId),
		);
	}

	const byId = await documentOf("engine");
	assert.equal(
		byId.status,
		200,
		"the player's own session answers a request naming no device",
	);
	assert.equal(byId.body.id, "engine");
});

test("detached sessions are listed after the player's in the order they were created", async () => {
	fresh();
	const first = await create("device-a");
	const second = await create("device-a");
	const third = await create("device-a");

	assert.deepEqual(await listedFor("device-a"), [
		"engine",
		first,
		second,
		third,
	]);
});

test("a private session is listed to its members alone, and to anybody else reads exactly as an id nobody issued", async () => {
	fresh();
	const id = await create("device-a");

	assert.deepEqual(await listedFor("device-a"), ["engine", id]);
	assert.deepEqual(await listedFor("device-b"), ["engine"]);
	assert.deepEqual(await listedFor(), ["engine"]);

	const member = await documentOf(id, "device-a");
	assert.equal(member.status, 200);
	assertConforms("getSession", 200, member.body);
	assert.equal(member.body.id, id);

	const unknown = await documentOf("never-issued", "device-a");
	assertNoSuchSession(unknown, "an id nobody issued");
	for (const deviceId of ["device-b", undefined]) {
		const stranger = await documentOf(id, deviceId);
		assert.equal(stranger.status, unknown.status, String(deviceId));
		assert.equal(stranger.text, unknown.text, String(deviceId));
	}
});

test("a shared session is listed to every device and to none", async () => {
	fresh();
	const id = await create("device-a");
	assert.equal((await share(id, "device-a", true)).status, 200);

	for (const deviceId of ["device-a", "device-b", undefined]) {
		assert.deepEqual(
			await listedFor(deviceId),
			["engine", id],
			String(deviceId),
		);
		assert.equal(
			(await documentOf(id, deviceId)).status,
			200,
			String(deviceId),
		);
	}
});

test("a session counts each listening device once, and its roster names them to its members alone", async () => {
	const state = fresh();
	const id = await create("device-a");
	const roster = (deviceId?: string) =>
		send("GET", "/stream/listeners", { session: id, deviceId });

	const hall = state.addSessionListener(id, {
		deviceId: "device-b",
		name: "Hall speaker",
	});
	state.addSessionListener(id, { deviceId: "device-b", name: "Hall speaker" });
	state.addSessionListener(id, { deviceId: "device-c", name: null });

	assert.equal((await documentOf(id, "device-a")).body.listeners, 2);
	const answered = await roster("device-a");
	assert.equal(answered.status, 200);
	assertConforms("getStreamListeners", 200, answered.body);
	const devices = answered.body.devices.map(
		(one: { deviceId: string; name: string | null; connections: number }) => [
			one.deviceId,
			one.name,
			one.connections,
		],
	);
	assert.deepEqual(devices.sort(), [
		["device-b", "Hall speaker", 2],
		["device-c", null, 1],
	]);
	assert.deepEqual(
		await listedFor("device-b"),
		["engine", id],
		"a device listening to a session is one of its members",
	);

	const players = await send("GET", "/stream/listeners", {
		deviceId: "device-a",
	});
	assert.deepEqual(
		players.body.devices,
		[],
		"a session's listener is not the player's",
	);
	assert.equal(
		players.body.playerMuted,
		false,
		"a session's listener silenced the player",
	);
	assert.equal(
		players.body.connections,
		answered.body.connections,
		"connections counts every session together, whichever is named",
	);

	assertNoSuchSession(
		await roster("device-d"),
		"a stranger read a private roster",
	);
	assertNoSuchSession(
		await roster(undefined),
		"no device read a private roster",
	);

	hall.close();
	assert.equal(
		(await documentOf(id, "device-a")).body.listeners,
		2,
		"one of two connections closed",
	);
});

test("any device that sees a session shares it or stops sharing it, and becomes a member by doing so", async () => {
	fresh();
	const id = await create("device-a");

	const shared = await share(id, "device-a", true);
	assert.equal(shared.status, 200);
	assertConforms("shareSession", 200, shared.body);
	assert.equal(shared.body.shared, true);
	assert.deepEqual(await listedFor("device-c"), ["engine", id]);

	const unshared = await share(id, "device-b", false);
	assert.equal(unshared.status, 200);
	assert.equal(unshared.body.shared, false);
	assert.deepEqual(await listedFor("device-b"), ["engine", id]);
	assert.deepEqual(await listedFor("device-c"), ["engine"]);
	assert.deepEqual(await listedFor("device-a"), ["engine", id]);
});

test("sharing moves the session's revision, and the player's stays at zero", async () => {
	fresh();
	const id = await create("device-a");
	const before = (await poll({ session: id, deviceId: "device-a" }))
		.sessionRevision;

	await share(id, "device-a", true);

	const after = (await poll({ session: id, deviceId: "device-a" }))
		.sessionRevision;
	assert.ok(after > before, `${after} after ${before}`);
	assert.equal((await poll()).sessionRevision, 0);
});

// The session is judged before the body, so a stranger learns nothing from a bad body either.
test("a device that may not see a private session cannot share it, and nothing changes", async () => {
	fresh();
	const id = await create("device-a");

	for (const shared of [true, "yes"]) {
		assertNoSuchSession(
			await share(id, "device-b", shared),
			JSON.stringify(shared),
		);
	}

	assert.equal((await documentOf(id, "device-a")).body.shared, false);
	assert.deepEqual(await listedFor("device-b"), ["engine"]);
});

test("the player's own session cannot be shared or unshared, by anybody", async () => {
	fresh();

	for (const [deviceId, shared] of [
		["device-a", false],
		["device-a", "yes"],
		[undefined, false],
	] as const) {
		const answer = await send("POST", "/sessions/engine", {
			deviceId,
			body: { shared },
		});
		assert.equal(answer.status, 409, `${deviceId} ${shared}`);
		assert.deepEqual(answer.body, {
			error: "the engine session cannot be changed",
		});
	}
});

test("a share names its device in the query and a boolean in the body", async () => {
	fresh();
	const id = await create("device-a");

	const noDevice = await send("POST", `/sessions/${id}`, {
		body: { shared: true },
	});
	assert.equal(noDevice.status, 400);
	assert.deepEqual(noDevice.body, { error: "'deviceId' is required" });

	const notBoolean = await share(id, "device-a", "yes");
	assert.equal(notBoolean.status, 400);
	assert.deepEqual(notBoolean.body, {
		error: "'shared' must be true or false",
	});

	assert.equal((await documentOf(id, "device-a")).body.shared, false);
});

test("a poll naming a shared session and a device makes that device a member, and one naming no device holds nothing", async () => {
	fresh();
	const id = await create("device-a");
	await share(id, "device-a", true);

	assert.equal(
		(await send("GET", "/state", { session: id, deviceId: "device-b" })).status,
		200,
	);
	assert.equal((await send("GET", "/state", { session: id })).status, 200);
	await share(id, "device-a", false);

	assert.deepEqual(await listedFor("device-b"), ["engine", id]);
	assert.deepEqual(await listedFor("device-c"), ["engine"]);
	assertNoSuchSession(
		await send("GET", "/state", { session: id }),
		"a poll naming no device",
	);
});

test("a command naming a session keeps nothing for the device that sent it", async () => {
	fresh();
	const id = await create("device-a");
	await share(id, "device-a", true);

	const answer = await send("POST", "/playback/next", {
		session: id,
		deviceId: "device-b",
	});
	assert.equal(answer.status, 204);
	await share(id, "device-a", false);

	assert.deepEqual(await listedFor("device-b"), ["engine"]);
	assertNoSuchSession(
		await documentOf(id, "device-b"),
		"a device that only sent a command",
	);
});

test("a ticket for a shared session makes its device a member, and an anonymous ticket listens without joining", async () => {
	fresh();
	const id = await create("device-a");
	await share(id, "device-a", true);

	const named = await send("POST", "/stream/ticket", {
		session: id,
		body: { deviceId: "device-b", name: "Laptop" },
	});
	assert.equal(named.status, 200);
	assertConforms("issueStreamTicket", 200, named.body);
	assert.equal(
		(await send("POST", "/stream/ticket", { session: id })).status,
		200,
	);
	await share(id, "device-a", false);

	assert.deepEqual(await listedFor("device-b"), ["engine", id]);
	assertNoSuchSession(
		await send("POST", "/stream/ticket", { session: id }),
		"an anonymous ticket for a private session",
	);
	assertNoSuchSession(
		await send("POST", "/stream/ticket", {
			session: id,
			body: { deviceId: "device-c" },
		}),
		"a stranger's ticket for a private session",
	);
});

test("a session ends when its last member leaves, and every route naming it says no such session after", async () => {
	fresh();
	const id = await create("device-a");

	const answer = await leave(id, "device-a");
	assert.equal(answer.status, 204);

	assertNoSuchSession(await documentOf(id, "device-a"), "the document");
	assert.deepEqual(await listedFor("device-a"), ["engine"]);
	for (const { id: route, example } of await fake.examples()) {
		assertNoSuchSession(
			await fake.sendExample(route, example, {
				session: id,
				deviceId: "device-a",
			}),
			route,
		);
	}
});

// `foo_jean` remembers a leave that reaches it before the stream's socket closes, so a client
// leaving once is enough whichever arrives first.
test("a leave from a device that still holds a connection ends nothing until that connection closes, and the close ends it", async () => {
	const state = fresh();
	const id = await create("device-a");
	const listening = state.addSessionListener(id, {
		deviceId: "device-a",
		name: null,
	});

	assert.equal((await leave(id, "device-a")).status, 204);
	const still = await documentOf(id, "device-a");
	assert.equal(still.status, 200);
	assert.equal(still.body.listeners, 1);

	listening.close();
	assertNoSuchSession(
		await documentOf(id, "device-a"),
		"after the connection closed",
	);
});

test("a device that left and connects again before its last connection closes is still a member once that closes", async () => {
	const state = fresh();
	const id = await create("device-a");
	const first = state.addSessionListener(id, {
		deviceId: "device-a",
		name: null,
	});

	await leave(id, "device-a");
	const second = state.addSessionListener(id, {
		deviceId: "device-a",
		name: null,
	});
	first.close();
	second.close();

	assert.equal((await documentOf(id, "device-a")).status, 200);
});

test("one device holding two connections is one listener, and the session outlives the first closing", async () => {
	const state = fresh();
	const id = await create("device-a");
	const probe = state.addSessionListener(id, {
		deviceId: "device-a",
		name: "Phone",
	});
	const stream = state.addSessionListener(id, {
		deviceId: "device-a",
		name: "Phone",
	});

	assert.equal((await documentOf(id, "device-a")).body.listeners, 1);
	const roster = await send("GET", "/stream/listeners", {
		session: id,
		deviceId: "device-a",
	});
	assert.deepEqual(
		roster.body.devices.map((one: { connections: number }) => one.connections),
		[2],
	);

	probe.close();
	assert.equal((await leave(id, "device-a")).status, 204);
	assert.equal((await documentOf(id, "device-a")).body.listeners, 1);

	stream.close();
	await leave(id, "device-a");
	assertNoSuchSession(
		await documentOf(id, "device-a"),
		"after the second connection closed",
	);
});

test("a leave ends what it ends in the session it names and in no other", async () => {
	fresh();
	const first = await create("device-a");
	const second = await create("device-a");
	await fake.poll({ session: second, deviceId: "device-a" });

	assert.equal((await leave(first, "device-a")).status, 204);

	assertNoSuchSession(await documentOf(first, "device-a"), "the session left");
	assert.equal((await documentOf(second, "device-a")).status, 200);
	assert.deepEqual(await listedFor("device-a"), ["engine", second]);
});

test("a leave from a device never in a shared session ends nothing, and from a stranger to a private one is refused", async () => {
	fresh();
	const shared = await create("device-a");
	await share(shared, "device-a", true);
	const hidden = await create("device-a");

	assert.equal((await leave(shared, "device-b")).status, 204);
	assert.equal((await documentOf(shared, "device-a")).status, 200);

	assertNoSuchSession(await leave(hidden, "device-b"), "a stranger's leave");
	assert.equal((await documentOf(hidden, "device-a")).status, 200);
});

test("a leave names its device in the body", async () => {
	fresh();
	const id = await create("device-a");

	const answer = await send("POST", "/stream/leave", {
		session: id,
		deviceId: "device-a",
		body: {},
	});

	assert.equal(answer.status, 400);
	assert.equal((await documentOf(id, "device-a")).status, 200);
});

test("a session set to play reads paused while nobody listens, and playing from the moment a connection does", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	assert.equal((await playRow(scope, "p5", 1)).status, 204);

	assert.equal((await poll(scope)).playback, "paused");
	assert.equal((await documentOf(id, "device-a")).body.playback, "paused");

	const listening = state.addSessionListener(id, {
		deviceId: "device-a",
		name: null,
	});
	assert.equal((await poll(scope)).playback, "playing");
	assert.equal((await documentOf(id, "device-a")).body.playback, "playing");

	listening.close();
	assert.equal((await poll(scope)).playback, "paused");
});

test("play-pause on a session paused only because nobody listens leaves it set to play", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 1);

	assert.equal((await send("POST", "/playback/play-pause", scope)).status, 204);
	assert.equal((await poll(scope)).playback, "paused");

	state.addSessionListener(id, { deviceId: "device-a", name: null });
	assert.equal((await poll(scope)).playback, "playing");
});

test("a session its controller paused reads paused whoever listens, and play-pause sets it to play again", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 1);
	const listening = state.addSessionListener(id, {
		deviceId: "device-a",
		name: null,
	});

	await send("POST", "/playback/play-pause", scope);
	assert.equal((await poll(scope)).playback, "paused", "paused while heard");

	listening.close();
	await send("POST", "/playback/play-pause", scope);
	assert.equal(
		(await poll(scope)).playback,
		"paused",
		"set to play, and nobody hears it",
	);

	state.addSessionListener(id, { deviceId: "device-a", name: null });
	assert.equal((await poll(scope)).playback, "playing");
});

test("pause on a session nobody hears pauses it, and pause and resume each land however often sent", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 1);

	assert.equal((await send("POST", "/playback/pause", scope)).status, 204);
	state.addSessionListener(id, { deviceId: "device-a", name: null });
	assert.equal((await poll(scope)).playback, "paused");

	await send("POST", "/playback/pause", scope);
	assert.equal((await poll(scope)).playback, "paused");

	await send("POST", "/playback/resume", scope);
	await send("POST", "/playback/resume", scope);
	assert.equal((await poll(scope)).playback, "playing");

	await send("POST", "/playback/stop", scope);
	await send("POST", "/playback/pause", scope);
	assert.equal((await poll(scope)).playback, "stopped");
	await send("POST", "/playback/resume", scope);
	assert.equal((await poll(scope)).playback, "playing");
});

test("a listener coming or going moves the poll's validator with playback, and never the session's revision", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 1);
	const unheard = await send("GET", "/state", scope);
	const revision = unheard.body.player.sessionRevision;

	const listening = state.addSessionListener(id, {
		deviceId: "device-b",
		name: null,
	});
	const heard = await send("GET", "/state", {
		...scope,
		headers: { "If-None-Match": String(unheard.headers.get("etag")) },
	});
	assert.equal(heard.status, 200);
	assert.equal(heard.body.player.playback, "playing");
	assert.equal(heard.body.player.sessionRevision, revision);

	listening.close();
	const gone = await send("GET", "/state", {
		...scope,
		headers: { "If-None-Match": String(heard.headers.get("etag")) },
	});
	assert.equal(gone.status, 200);
	assert.equal(gone.body.player.playback, "paused");
	assert.equal(gone.body.player.sessionRevision, revision);
});

test("a report added from outside reaches the session's document with its track, and moves the session's revision", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 2);
	const before = await poll(scope);

	state.addSessionReport(id, trackAt(state, "p5", 2));

	const answer = await documentOf(id, "device-a");
	assertConforms("getSession", 200, answer.body);
	assert.deepEqual(answer.body.reports, [
		{
			sequence: 1,
			kind: "undecodable",
			path: before.path,
			subsong: before.subsong,
			libraryPath: before.libraryPath,
		},
	]);
	assert.equal(answer.body.chainDropped, false);
	assert.ok((await poll(scope)).sessionRevision > before.sessionRevision);
	assert.deepEqual((await documentOf("engine")).body.reports, []);
});

test("a session keeps its last eight reports, numbered across its whole life", async () => {
	const state = fresh();
	const id = await create("device-a");

	for (let index = 0; index < 9; index += 1)
		state.addSessionReport(id, trackAt(state, "p7", index));

	const { reports } = (await documentOf(id, "device-a")).body;
	assert.deepEqual(
		reports.map((one: { sequence: number }) => one.sequence),
		[2, 3, 4, 5, 6, 7, 8, 9],
	);
	assert.equal(reports[0].path, pathAt(state, "p7", 1));
});

test("a dropped chain is reported once and stays dropped for the rest of the session's life", async () => {
	const state = fresh();
	const id = await create("device-a");
	const scope = { session: id, deviceId: "device-a" };
	await playRow(scope, "p5", 3);
	const before = await poll(scope);

	state.dropSessionChain(id);

	const dropped = (await documentOf(id, "device-a")).body;
	assert.equal(dropped.chainDropped, true);
	assert.deepEqual(
		dropped.reports.map((one: { kind: string; path: string }) => [
			one.kind,
			one.path,
		]),
		[["chainDropped", pathAt(state, "p5", 3)]],
	);
	assert.ok((await poll(scope)).sessionRevision > before.sessionRevision);

	for (let index = 0; index < 8; index += 1)
		state.addSessionReport(id, trackAt(state, "p7", index));

	const later = (await documentOf(id, "device-a")).body;
	assert.ok(
		later.reports.every((one: { kind: string }) => one.kind === "undecodable"),
	);
	assert.equal(later.chainDropped, true);
});

test("a session ended from outside answers no such session to its own members", async () => {
	const state = fresh();
	const id = await create("device-a");
	state.addSessionListener(id, { deviceId: "device-b", name: null });

	state.endSession(id);

	assertNoSuchSession(await documentOf(id, "device-a"), "its creator");
	assertNoSuchSession(
		await send("GET", "/state", { session: id, deviceId: "device-b" }),
		"its listener",
	);
	assert.deepEqual(await listedFor("device-a"), ["engine"]);
});

const logged = (method: string, path: string): RecordedRequest => ({
	method,
	path,
	body: null,
});

test("posts are counted by route and by the session they name, a post naming none or engine counting as the player's", () => {
	const requests = [
		logged("POST", "/api/playback/next"),
		logged("POST", "/api/playback/next?session=engine&deviceId=d"),
		logged("POST", "/api/playback/next?session=&deviceId=d"),
		logged("POST", "/api/playback/next?session=s%2F1&deviceId=d"),
		logged("POST", "/api/playback/next?deviceId=d&session=s%2F1"),
		logged("POST", "/api/playback/next?session=s2"),
	];

	assert.equal(
		requestLog.postsToSession(requests, "/api/playback/next", "engine"),
		3,
	);
	assert.equal(
		requestLog.postsToSession(requests, "/api/playback/next", "s/1"),
		2,
	);
	assert.equal(
		requestLog.postsToSession(requests, "/api/playback/next", "s2"),
		1,
	);
	assert.equal(
		requestLog.postsToSession(requests, "/api/playback/next", "s3"),
		0,
	);
});

test("a read and a route that only shares a prefix are not counted as posts to a route", () => {
	const requests = [
		logged("GET", "/api/queue?session=s1"),
		logged("POST", "/api/queue/move?session=s1"),
		logged("DELETE", "/api/queue?session=s1"),
		logged("POST", "/api/queue?session=s1"),
	];

	assert.equal(requestLog.postsToSession(requests, "/api/queue", "s1"), 1);
});
