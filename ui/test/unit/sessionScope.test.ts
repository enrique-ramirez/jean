import assert from "node:assert/strict";
import {
	after,
	afterEach,
	before,
	beforeEach,
	describe,
	test,
} from "node:test";
import createClient from "openapi-fetch";
import * as artwork from "../../src/shared/api/artwork.ts";
import * as client from "../../src/shared/api/client.ts";
import type { paths } from "../../src/shared/api/fooJeanSchema.d.ts";
import { playPause, seekTo, setVolume } from "../../src/shared/api/playback.ts";
import { playPlaylistItem } from "../../src/shared/api/playlists.ts";
import {
	clearQueue,
	fetchQueue,
	removeQueueEntry,
} from "../../src/shared/api/queue.ts";
import type * as Sessions from "../../src/shared/api/sessions.ts";
import { fetchState } from "../../src/shared/api/state.ts";
import {
	fetchStreamTimeline,
	issueStreamTicket,
	leaveStream,
} from "../../src/shared/api/stream.ts";
import {
	fetchLibraryTrack,
	fetchPlayingTrack,
} from "../../src/shared/api/tracks.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

true satisfies Same<
	keyof typeof client.SESSION_SCOPED,
	client.SessionScopedPath
>;

const ORIGIN = "http://player.test";
// foo_jean's session ids are opaque, so nothing promises they are safe in a URL as issued.
const SCOPE = {
	session: "s+1/2=&x",
	deviceId: "3f8a1c0e2b7d4a919c3351e0a2f6d4b8",
};
const OTHER_SCOPE = {
	session: "d7e19a",
	deviceId: "0b5e77c2a1d94f3e8c6b2a7d9e4f1c08",
};
const DEVICE = { deviceId: SCOPE.deviceId, name: "Android phone" };

// foo_jean reads the device from the body on these two and never from the query.
const DEVICE_IN_BODY = new Set(["/stream/ticket", "/stream/leave"]);

interface Sent {
	method: string;
	url: URL;
	headers: [string, string][];
	body: string;
}

let sent: Sent[] = [];
let answer: unknown = {};
let waiting: (() => void)[] = [];
const realFetch = globalThis.fetch;

before(() => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(input, init);
		sent.push({
			method: request.method,
			url: new URL(request.url),
			headers: [...request.headers].sort(([a], [b]) => a.localeCompare(b)),
			body: await request.text(),
		});
		for (const wake of waiting.splice(0)) wake();
		return new Response(JSON.stringify(answer), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
});

after(() => {
	globalThis.fetch = realFetch;
});

beforeEach(() => {
	sent = [];
	answer = {};
	waiting = [];
});

afterEach(() => {
	client.setSessionScope?.(null);
});

const setScope = (scope: client.SessionScope | null) => {
	assert.equal(
		typeof client.setSessionScope,
		"function",
		"client.ts exports setSessionScope",
	);
	client.setSessionScope(scope);
};

const untilSent = async (count: number) => {
	while (sent.length < count)
		await new Promise<void>((wake) => waiting.push(wake));
};

const only = async (send: () => unknown): Promise<Sent> => {
	const before = sent.length;
	await send();
	await untilSent(before + 1);
	assert.equal(sent.length, before + 1, "one request went out");
	return sent[before];
};

const all = (url: URL, name: string) => url.searchParams.getAll(name);

const queryWithout = (url: URL, ...names: string[]) =>
	[...url.searchParams]
		.filter(([name]) => !names.includes(name))
		.map(([name, value]) => `${name}=${value}`)
		.sort();

const assertSameRequest = (actual: Sent, expected: Sent) => {
	assert.equal(actual.url.href, expected.url.href);
	assert.equal(actual.method, expected.method);
	assert.deepEqual(actual.headers, expected.headers);
	assert.equal(actual.body, expected.body);
};

const assertScoped = (
	scoped: Sent,
	unscoped: Sent,
	path: string,
	scope: client.SessionScope,
) => {
	assert.deepEqual(all(scoped.url, "session"), [scope.session], path);
	if (!DEVICE_IN_BODY.has(path))
		assert.deepEqual(all(scoped.url, "deviceId"), [scope.deviceId], path);
	assert.equal(
		scoped.url.origin + scoped.url.pathname,
		unscoped.url.origin + unscoped.url.pathname,
		path,
	);
	assert.deepEqual(
		queryWithout(scoped.url, "session", "deviceId"),
		queryWithout(unscoped.url, "session", "deviceId"),
		path,
	);
	assert.equal(scoped.method, unscoped.method, path);
	assert.deepEqual(scoped.headers, unscoped.headers, path);
	assert.equal(scoped.body, unscoped.body, path);
};

type LooseClient = {
	GET: (path: string, init: object) => Promise<unknown>;
};

const pathParams = (path: string) =>
	Object.fromEntries(
		[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, "7"]),
	);

const callQuery = { revision: "4" };

const askAt = (path: string, query: Record<string, string> = callQuery) =>
	client.ask(ORIGIN, 1_000, (api, init) =>
		(api as unknown as LooseClient).GET(path, {
			...init,
			params: { path: pathParams(path), query },
		}),
	);

const bare = createClient<paths>({
	fetch: (request) => globalThis.fetch(request),
});

const bareAt = (path: string, query: Record<string, string> = callQuery) =>
	(bare as unknown as LooseClient).GET(path, {
		baseUrl: `${ORIGIN}/api`,
		params: { path: pathParams(path), query },
	});

const scopedPaths = () => {
	assert.equal(
		typeof client.SESSION_SCOPED,
		"object",
		"client.ts exports SESSION_SCOPED",
	);
	return Object.keys(client.SESSION_SCOPED);
};

test("no scope is set when the client loads, so the first request names no session", async () => {
	assert.equal(client.sessionScope?.() ?? null, null);
	const queue = await only(() => fetchQueue(ORIGIN));
	assert.equal(queue.url.href, `${ORIGIN}/api/queue`);
});

describe("a path the contract scopes", () => {
	test("goes out naming the scope's session and device beside the call's own query while a scope is set", async () => {
		const paths = scopedPaths();
		assert.ok(paths.length > 0);
		for (const path of paths) {
			const unscoped = await only(() => bareAt(path));
			setScope(SCOPE);
			const scoped = await only(() => askAt(path));
			setScope(null);
			assert.deepEqual(all(scoped.url, "revision"), ["4"], path);
			assertScoped(scoped, unscoped, path, SCOPE);
		}
	});

	test("goes out exactly as an unscoped client sends it while no scope is set", async () => {
		for (const path of scopedPaths()) {
			const expected = await only(() => bareAt(path));
			const actual = await only(() => askAt(path));
			assertSameRequest(actual, expected);
		}
	});

	test("keeps the session or device a call names itself and adds no second one", async () => {
		setScope(SCOPE);

		const namesSession = await only(() =>
			askAt("/state", { session: OTHER_SCOPE.session }),
		);
		assert.deepEqual(all(namesSession.url, "session"), [OTHER_SCOPE.session]);
		assert.deepEqual(all(namesSession.url, "deviceId"), [SCOPE.deviceId]);

		const namesDevice = await only(() =>
			askAt("/state", { deviceId: OTHER_SCOPE.deviceId }),
		);
		assert.deepEqual(all(namesDevice.url, "session"), [SCOPE.session]);
		assert.deepEqual(all(namesDevice.url, "deviceId"), [OTHER_SCOPE.deviceId]);

		const ticket = await only(() =>
			client.ask(ORIGIN, 1_000, (api, init) =>
				api.POST("/stream/ticket", {
					...init,
					params: { query: { session: OTHER_SCOPE.session } },
					body: DEVICE,
				}),
			),
		);
		assert.deepEqual(all(ticket.url, "session"), [OTHER_SCOPE.session]);
	});
});

interface PublicCall {
	name: string;
	path: string;
	url: string;
	send: () => unknown;
}

const PUBLIC_CALLS: PublicCall[] = [
	{
		name: "fetchState",
		path: "/state",
		url: "/api/state",
		send: () => fetchState(ORIGIN, '"v1"'),
	},
	{
		name: "fetchQueue",
		path: "/queue",
		url: "/api/queue",
		send: () => fetchQueue(ORIGIN),
	},
	{
		name: "fetchPlayingTrack",
		path: "/track/playing",
		url: "/api/track/playing?columns=%25title%25&columns=%25artist%25",
		send: () => fetchPlayingTrack(ORIGIN, ["%title%", "%artist%"]),
	},
	{
		name: "fetchStreamTimeline",
		path: "/stream/timeline",
		url: "/api/stream/timeline",
		send: () => fetchStreamTimeline(ORIGIN, null),
	},
	{
		name: "playPause",
		path: "/playback/play-pause",
		url: "/api/playback/play-pause",
		send: () => playPause(ORIGIN),
	},
	{
		name: "playPlaylistItem",
		path: "/playlists/{id}/items/{index}/play",
		url: "/api/playlists/00000000-0000-4000-8000-000000000007/items/2/play",
		send: () =>
			playPlaylistItem(ORIGIN, "00000000-0000-4000-8000-000000000007", 2),
	},
	{
		name: "seekTo",
		path: "/playback/seek",
		url: "/api/playback/seek",
		send: () => seekTo(ORIGIN, 42),
	},
	{
		name: "removeQueueEntry",
		path: "/queue/{index}",
		url: "/api/queue/3?revision=7",
		send: () => removeQueueEntry(ORIGIN, 3, 7),
	},
	{
		name: "clearQueue",
		path: "/queue",
		url: "/api/queue",
		send: () => clearQueue(ORIGIN),
	},
	{
		name: "issueStreamTicket",
		path: "/stream/ticket",
		url: "/api/stream/ticket",
		send: () => issueStreamTicket(ORIGIN, DEVICE, null),
	},
	{
		name: "leaveStream",
		path: "/stream/leave",
		url: "/api/stream/leave",
		send: () => leaveStream(ORIGIN, DEVICE.deviceId, null),
	},
];

describe("the calls Jean makes to a scoped path", () => {
	for (const call of PUBLIC_CALLS) {
		test(`${call.name} names the scope's session and device while one is set, and goes out as today with none`, async () => {
			const unscoped = await only(call.send);
			assert.equal(unscoped.url.href, `${ORIGIN}${call.url}`);

			setScope(SCOPE);
			const scoped = await only(call.send);
			assertScoped(scoped, unscoped, call.path, SCOPE);
		});
	}

	test("the ticket and the leave keep the device in their body and carry the session in the query", async () => {
		setScope(SCOPE);
		const ticket = await only(() => issueStreamTicket(ORIGIN, DEVICE, null));
		const leave = await only(() => leaveStream(ORIGIN, DEVICE.deviceId, null));

		assert.deepEqual(JSON.parse(ticket.body), DEVICE);
		assert.deepEqual(all(ticket.url, "session"), [SCOPE.session]);
		assert.deepEqual(JSON.parse(leave.body), { deviceId: DEVICE.deviceId });
		assert.deepEqual(all(leave.url, "session"), [SCOPE.session]);
	});

	test("clearing the scope stops it on the next request, and a new scope replaces the old one", async () => {
		setScope(SCOPE);
		await only(() => fetchQueue(ORIGIN));

		setScope(OTHER_SCOPE);
		const replaced = await only(() => fetchQueue(ORIGIN));
		assert.deepEqual(all(replaced.url, "session"), [OTHER_SCOPE.session]);
		assert.deepEqual(all(replaced.url, "deviceId"), [OTHER_SCOPE.deviceId]);

		setScope(null);
		assert.equal(client.sessionScope(), null);
		const cleared = await only(() => fetchQueue(ORIGIN));
		assert.equal(cleared.url.href, `${ORIGIN}/api/queue`);
	});
});

describe("a path the contract does not scope", () => {
	const UNSCOPED: { name: string; send: () => unknown }[] = [
		{ name: "GET /sessions", send: () => askAt("/sessions", {}) },
		{ name: "GET /stream", send: () => askAt("/stream", { ticket: "t1" }) },
		{ name: "setVolume", send: () => setVolume(ORIGIN, 0.5) },
		{
			name: "fetchLibraryTrack",
			send: () =>
				fetchLibraryTrack(
					ORIGIN,
					{ kind: "library", track: "a/b.flac", subsong: 0 },
					["%title%"],
				),
		},
	];

	for (const call of UNSCOPED) {
		test(`${call.name} goes out byte for byte the same while a scope is set`, async () => {
			const unscoped = await only(call.send);
			setScope(SCOPE);
			const scoped = await only(call.send);
			assertSameRequest(scoped, unscoped);
			assert.deepEqual(all(scoped.url, "session"), []);
		});
	}
});

describe("the playing track's artwork address", () => {
	test("is today's address while no scope is set", () => {
		assert.equal(
			artwork.playingArtworkUrl(ORIGIN),
			`${ORIGIN}/api/artwork/playing`,
		);
		assert.equal(artwork.playingArtworkUrl(null), null);
	});

	test("names the scope's session and device while one is set, and stops once it is cleared", () => {
		setScope(SCOPE);
		const scoped = new URL(String(artwork.playingArtworkUrl(ORIGIN)));
		assert.equal(
			scoped.origin + scoped.pathname,
			`${ORIGIN}/api/artwork/playing`,
		);
		assert.deepEqual(all(scoped, "session"), [SCOPE.session]);
		assert.deepEqual(all(scoped, "deviceId"), [SCOPE.deviceId]);

		setScope(null);
		assert.equal(
			artwork.playingArtworkUrl(ORIGIN),
			`${ORIGIN}/api/artwork/playing`,
		);
	});
});

describe("the session routes", () => {
	const SESSION_ID = "d7e19a";
	const DOCUMENT = { id: SESSION_ID, kind: "detached", shared: false };

	const sessions = async () => {
		const loaded: Partial<typeof Sessions> = await import(
			"../../src/shared/api/sessions.ts"
		).catch(() => ({}));
		for (const name of [
			"createSession",
			"listSessions",
			"readSession",
			"shareSession",
		] as const)
			assert.equal(
				typeof loaded[name],
				"function",
				`sessions.ts exports ${name}`,
			);
		return loaded as typeof Sessions;
	};

	test("createSession posts the device as JSON to /sessions and answers the session", async () => {
		const { createSession } = await sessions();
		answer = DOCUMENT;
		let answered: unknown;
		const request = await only(async () => {
			answered = await createSession(ORIGIN, DEVICE);
		});

		assert.equal(request.method, "POST");
		assert.equal(request.url.href, `${ORIGIN}/api/sessions`);
		assert.match(
			new Headers(request.headers).get("content-type") ?? "",
			/^application\/json/,
		);
		assert.deepEqual(JSON.parse(request.body), DEVICE);
		assert.deepEqual((answered as { data?: unknown }).data, DOCUMENT);
	});

	test("listSessions asks /sessions naming the device", async () => {
		const { listSessions } = await sessions();
		const request = await only(() => listSessions(ORIGIN, DEVICE.deviceId));

		assert.equal(request.method, "GET");
		assert.equal(
			request.url.origin + request.url.pathname,
			`${ORIGIN}/api/sessions`,
		);
		assert.deepEqual(queryWithout(request.url), [
			`deviceId=${DEVICE.deviceId}`,
		]);
		assert.equal(request.body, "");
	});

	test("readSession asks for the one session naming the device", async () => {
		const { readSession } = await sessions();
		answer = DOCUMENT;
		let answered: unknown;
		const request = await only(async () => {
			answered = await readSession(ORIGIN, SESSION_ID, DEVICE.deviceId);
		});

		assert.equal(request.method, "GET");
		assert.equal(
			request.url.origin + request.url.pathname,
			`${ORIGIN}/api/sessions/${SESSION_ID}`,
		);
		assert.deepEqual(queryWithout(request.url), [
			`deviceId=${DEVICE.deviceId}`,
		]);
		assert.deepEqual((answered as { data?: unknown }).data, DOCUMENT);
	});

	test("shareSession posts shared, true or false, to the session naming the device", async () => {
		const { shareSession } = await sessions();
		for (const shared of [true, false]) {
			const request = await only(() =>
				shareSession(ORIGIN, SESSION_ID, DEVICE.deviceId, shared),
			);

			assert.equal(request.method, "POST");
			assert.equal(
				request.url.origin + request.url.pathname,
				`${ORIGIN}/api/sessions/${SESSION_ID}`,
			);
			assert.deepEqual(queryWithout(request.url), [
				`deviceId=${DEVICE.deviceId}`,
			]);
			assert.deepEqual(JSON.parse(request.body), { shared });
		}
	});

	test("none of the four names a session while a scope is set", async () => {
		const { createSession, listSessions, readSession, shareSession } =
			await sessions();
		setScope(OTHER_SCOPE);
		const requests = [
			await only(() => createSession(ORIGIN, DEVICE)),
			await only(() => listSessions(ORIGIN, DEVICE.deviceId)),
			await only(() => readSession(ORIGIN, SESSION_ID, DEVICE.deviceId)),
			await only(() => shareSession(ORIGIN, SESSION_ID, DEVICE.deviceId, true)),
		];
		for (const request of requests) {
			assert.deepEqual(all(request.url, "session"), [], request.url.href);
			assert.ok(
				!all(request.url, "deviceId").includes(OTHER_SCOPE.deviceId),
				request.url.href,
			);
		}
	});
});
