import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before } from "node:test";

import { conforms } from "../../../contract/shape.ts";
import { type Operation, publishedOperations } from "../../../contract/spec.ts";
import type { FooJeanOptions } from "../fake-api/fooJean.ts";
import { createServer } from "../fake-api/server.ts";
import { createState, evaluate } from "../fake-api/state.ts";

export type FakeState = ReturnType<typeof createState>;

// biome-ignore lint/suspicious/noExplicitAny: an answer is read field by field, as each case needs
export type Body = any;

export interface Answer {
	status: number;
	text: string;
	body: Body;
	headers: Headers;
}

export interface Scope {
	session?: string;
	deviceId?: string;
}

export const NO_SUCH_SESSION = { error: "no such session" };

export const DETACHED_ORDERS = [
	"inOrder",
	"repeatAll",
	"repeatOne",
	"random",
	"shuffleTracks",
];

const OPERATIONS = publishedOperations();

export const operation = (id: string): Operation => {
	const found = OPERATIONS.find((one) => one.id === id);
	assert.ok(found, `the contract publishes no operation ${id}`);
	return found;
};

const takes = (one: Operation, name: string) =>
	one.parameters.some(
		(parameter) => parameter.in === "query" && parameter.name === name,
	);

export const SESSION_SCOPED = OPERATIONS.filter((one) => takes(one, "session"));

export const assertConforms = (
	operationId: string,
	status: number,
	body: unknown,
) => {
	const schema = operation(operationId).published.get(status);
	assert.ok(
		schema,
		`the contract publishes no body for ${operationId} ${status}`,
	);
	assert.deepEqual(conforms(schema, body), [], `${operationId} ${status}`);
};

export interface Example {
	method: string;
	path: string;
	query?: Record<string, string>;
	body?: unknown;
}

const EXAMPLES: Record<
	string,
	(state: FakeState, structure: number) => Example
> = {
	getState: () => ({ method: "GET", path: "/state" }),
	playPlaylistRow: (state) => ({
		method: "POST",
		path: `/playlists/${guidOf(state, "p5")}/items/0/play`,
	}),
	playLibrarySet: (_, structure) => ({
		method: "POST",
		path: "/playback/play",
		body: { structure, ordinals: [0, 1], index: 0 },
	}),
	playPause: () => ({ method: "POST", path: "/playback/play-pause" }),
	nextTrack: () => ({ method: "POST", path: "/playback/next" }),
	previousTrack: () => ({ method: "POST", path: "/playback/previous" }),
	stop: () => ({ method: "POST", path: "/playback/stop" }),
	seek: () => ({
		method: "POST",
		path: "/playback/seek",
		body: { seconds: 1 },
	}),
	setPlaybackMode: () => ({
		method: "POST",
		path: "/playback/mode",
		body: { mode: "repeatAll" },
	}),
	getQueue: () => ({ method: "GET", path: "/queue" }),
	queueTracks: (state) => ({
		method: "POST",
		path: "/queue",
		body: { playlistId: guidOf(state, "p5"), positions: [0] },
	}),
	clearQueue: () => ({ method: "DELETE", path: "/queue" }),
	moveQueueEntry: () => ({
		method: "POST",
		path: "/queue/move",
		body: { from: 0, to: 0, revision: 0 },
	}),
	removeQueueEntry: () => ({
		method: "DELETE",
		path: "/queue/0",
		query: { revision: "0" },
	}),
	getPlayingTrack: () => ({
		method: "GET",
		path: "/track/playing",
		query: { columns: "%title%" },
	}),
	getPlayingArtwork: () => ({ method: "GET", path: "/artwork/playing" }),
	issueStreamTicket: () => ({ method: "POST", path: "/stream/ticket" }),
	getStreamListeners: () => ({ method: "GET", path: "/stream/listeners" }),
	leaveStream: () => ({ method: "POST", path: "/stream/leave" }),
	getStreamTimeline: () => ({ method: "GET", path: "/stream/timeline" }),
};

export const guidOf = (state: FakeState, key: string) => {
	const playlist = state.playlistById(key);
	assert.ok(playlist, `the fixture holds no playlist ${key}`);
	return playlist.guid;
};

export const trackAt = (state: FakeState, key: string, index: number) => {
	const track = state.playlistById(key)?.items[index];
	assert.ok(track, `the fixture holds no row ${index} in ${key}`);
	return track;
};

export const pathAt = (state: FakeState, key: string, index: number) =>
	String(evaluate(trackAt(state, key, index), "%path%"));

export const titleAt = (state: FakeState, key: string, index: number) =>
	String(evaluate(trackAt(state, key, index), "%title%"));

const PLAYER_POSITION_SECONDS = 30;

export function fakePlayer() {
	const server = createServer();
	let origin = "";
	let state: FakeState = createState();

	before(async () => {
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	after(() => {
		server.close();
	});

	const send = async (
		method: string,
		path: string,
		{
			session,
			deviceId,
			query = {},
			body,
			headers = {},
		}: Scope & {
			query?: Record<string, string>;
			body?: unknown;
			headers?: Record<string, string>;
		} = {},
	): Promise<Answer> => {
		const url = new URL(`/api${path}`, origin);
		if (session !== undefined) url.searchParams.set("session", session);
		if (deviceId !== undefined) url.searchParams.set("deviceId", deviceId);
		for (const [name, value] of Object.entries(query))
			url.searchParams.append(name, value);
		const response = await fetch(url, {
			method,
			headers: { "Content-Type": "application/json", ...headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const isJson =
			response.headers.get("content-type")?.includes("json") ?? false;
		const text = isJson ? await response.text() : "";
		if (!isJson) await response.arrayBuffer();
		return {
			status: response.status,
			text,
			body: isJson && text ? JSON.parse(text) : null,
			headers: response.headers,
		};
	};

	const fresh = (fooJean: FooJeanOptions = {}): FakeState => {
		state = server.reset(
			createState({
				fooJean: { maxSessions: 4, canCreateSessions: true, ...fooJean },
			}),
		);
		state.startLibraryBuild(["%title%"]);
		state.finishLibraryBuild();
		state.playItem("p1", 1);
		state.patchPlayer({ position: PLAYER_POSITION_SECONDS });
		return state;
	};

	const create = async (deviceId: string, name?: string) => {
		const answer = await send("POST", "/sessions", {
			body: name === undefined ? { deviceId } : { deviceId, name },
		});
		assert.equal(
			answer.status,
			200,
			`the create for ${deviceId} answered ${answer.text}`,
		);
		return String(answer.body.id);
	};

	const poll = async (scope: Scope = {}) => {
		const answer = await send("GET", "/state", scope);
		assert.equal(answer.status, 200, `the poll answered ${answer.text}`);
		return answer.body.player;
	};

	const documentOf = (id: string, deviceId?: string) =>
		send("GET", `/sessions/${encodeURIComponent(id)}`, { deviceId });

	const listedFor = async (deviceId?: string): Promise<string[]> => {
		const answer = await send("GET", "/sessions", { deviceId });
		assert.equal(answer.status, 200);
		return answer.body.sessions.map((one: { id: string }) => one.id);
	};

	const share = (id: string, deviceId: string, shared: unknown) =>
		send("POST", `/sessions/${encodeURIComponent(id)}`, {
			deviceId,
			body: { shared },
		});

	const leave = (session: string, deviceId: string) =>
		send("POST", "/stream/leave", { session, body: { deviceId } });

	const playRow = (scope: Scope, key: string, index: number) =>
		send("POST", `/playlists/${guidOf(state, key)}/items/${index}/play`, scope);

	// Answers once the headers arrive. The body never ends, so the caller hangs up through `signal`.
	const openStream = (ticket: string, signal: AbortSignal) =>
		fetch(
			`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=opus`,
			{
				signal,
			},
		);

	const structure = async () =>
		(await send("GET", "/state")).body.library.structure;

	const playerAsSeen = async () => {
		const player = await poll();
		player.position = { seconds: player.position.seconds };
		return {
			player,
			queue: (await send("GET", "/queue")).body,
			playlists: (await send("GET", "/playlists")).body,
		};
	};

	// `contract/openapi.yaml` reads the device from the body on the ticket and the leave, and from
	// the query on every other route.
	const sendExample = (operationId: string, example: Example, scope: Scope) => {
		const inBody = !takes(operation(operationId), "deviceId");
		const deviceBody =
			inBody && scope.deviceId !== undefined
				? { deviceId: scope.deviceId }
				: undefined;
		return send(example.method, example.path, {
			session: scope.session,
			deviceId: inBody ? undefined : scope.deviceId,
			query: example.query,
			body: example.body ?? deviceBody,
		});
	};

	const examples = async () => {
		const held = await structure();
		const unexampled = SESSION_SCOPED.map((one) => one.id).filter(
			(id) => !(id in EXAMPLES),
		);
		assert.deepEqual(
			unexampled,
			[],
			"the contract scopes a route this harness never sends",
		);
		return SESSION_SCOPED.map((one) => ({
			id: one.id,
			example: EXAMPLES[one.id](state, held),
		}));
	};

	return {
		get state(): FakeState {
			return state;
		},
		send,
		fresh,
		create,
		poll,
		documentOf,
		listedFor,
		share,
		leave,
		playRow,
		openStream,
		structure,
		playerAsSeen,
		sendExample,
		examples,
	};
}

// Waits on a condition the fake reaches once a socket it served has closed, which it learns a
// moment after the client lets go.
export const eventually = async (
	check: () => Promise<boolean>,
	what: string,
	attempts = 100,
) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.fail(`never ${what}`);
};
