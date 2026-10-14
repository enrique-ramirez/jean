import assert from "node:assert/strict";
import { after, before, mock, type TestContext, test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { rememberSnapshot } from "../../src/domain/player/audible.ts";
import { deviceId } from "../../src/domain/player/device.ts";
import { startPlayerPoll } from "../../src/domain/player/playerPoll.ts";
import type * as SessionModule from "../../src/domain/player/session.ts";
import {
	commitSession,
	inSession,
	noteSessionGone,
	SESSION_KEY,
	sessionEpoch,
	sessionSnapshot,
	subscribeSession,
} from "../../src/domain/player/session.ts";
import { sessionScope, setSessionScope } from "../../src/shared/api/client.ts";
import type { FooJeanCapabilities } from "../../src/shared/api/discovery.ts";
import { playingTrack } from "../../src/shared/api/playerState.ts";
import type { QueueRead } from "../../src/shared/api/queue.ts";
import { fetchState, type StateDocument } from "../../src/shared/api/state.ts";
import type { PlayerSnapshot } from "../../src/shared/api/types.ts";

const ORIGIN = "http://player.invalid:8881";
const PLAYER_KEY = ["player"];
const QUEUE_KEY = ["queue"];
const ON_PLAYER = { id: null, role: null } as const;

const FIRST = "a1f0c3";
const SECOND = "b7e9d2";

const PLAYER_TRACK = "/music/On the player/01 House.flac";
const FIRST_TRACK = "/music/First session/01 One.flac";
const SECOND_TRACK = "/music/Second session/04 Four.flac";

const PLAYER_VOLUME = -6;

const ONE_TAG = '"t-shared"';
const ONE_QUEUE_REVISION = 3;

type PlayerSection = StateDocument["player"];

const stateDocument = (player: Partial<PlayerSection>): StateDocument => ({
	library: {
		ready: true,
		structure: 1,
		revision: 4,
		trackCount: 3,
		columns: ["%title%"],
		build: null,
		halted: false,
	},
	configGeneration: 0,
	mainThread: { answering: true, unansweredSeconds: null },
	player: {
		playback: "playing",
		path: PLAYER_TRACK,
		subsong: 0,
		libraryPath: null,
		album: null,
		albumArtist: null,
		currentPlaylistId: null,
		queueRevision: 0,
		playlistsRevision: 0,
		timelineRevision: 0,
		sessionRevision: 0,
		position: { seconds: 12, ageSeconds: 0 },
		duration: 180,
		volume: PLAYER_VOLUME,
		muted: false,
		playbackMode: "inOrder",
		outputDeviceId: null,
		outputSilent: null,
		title: null,
		artist: null,
		playingLocation: null,
		...player,
	},
});

const CAPABILITIES = {
	apiVersion: 1,
	allowedFields: [],
	canWrite: true,
	canWritePlaylists: false,
	canControlPlayback: true,
	canChangeOutput: false,
	maxAutoPlaylists: 100,
	canCreateAutoPlaylists: false,
	canStream: false,
	streamFormats: [],
	canMuteWhileStreaming: false,
	canReadLibrary: true,
	playerName: "foobar2000",
	playerVersion: "2.24.5",
	volumeMin: -100,
	volumeMax: 0,
	volumeUnit: "db",
	playbackModes: ["inOrder", "shuffleTracks"],
	maxSessions: 4,
	canCreateSessions: true,
} satisfies FooJeanCapabilities;

const queued = (title: string) => ({
	title,
	artist: "",
	duration: 60,
	album: "",
	albumArtist: "",
	libraryPath: null,
	location: null,
});

interface Asked {
	path: string;
	session: string | null;
	deviceId: string | null;
	ifNoneMatch: string | null;
}

type Answer = (asked: Asked) => Promise<Response>;

const answered = (document: StateDocument, tag: string) =>
	Promise.resolve(Response.json(document, { headers: { ETag: tag } }));

const notModified = () => Promise.resolve(new Response(null, { status: 304 }));

const never = () => new Promise<Response>(() => {});

const noSuchSession = () =>
	Promise.resolve(Response.json({ error: "no such session" }, { status: 404 }));

const outsideACase: Answer = () =>
	Promise.reject(new TypeError("a request outside a case"));

let asked: Asked[] = [];
let answer: Answer = outsideACase;

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;

before(() => {
	globalThis.fetch = ((request: Request) => {
		const url = new URL(request.url);
		const one: Asked = {
			path: url.pathname,
			session: url.searchParams.get("session"),
			deviceId: url.searchParams.get("deviceId"),
			ifNoneMatch: request.headers.get("If-None-Match"),
		};
		asked.push(one);
		return answer(one);
	}) as typeof fetch;

	globalThis.document = {
		visibilityState: "visible",
		hidden: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	} as unknown as Document;
});

after(() => {
	globalThis.fetch = realFetch;
	globalThis.document = realDocument;
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async () => {
	for (let step = 0; step < 5; step += 1) await flush();
};

const withReads =
	(state: Answer, queues: Record<string, string[]> = {}): Answer =>
	(one) => {
		if (one.path === "/api/state") return state(one);
		if (one.path === "/api/queue")
			return Promise.resolve(
				Response.json({
					revision: ONE_QUEUE_REVISION,
					entries: (queues[one.session ?? ""] ?? []).map(queued),
				}),
			);
		if (one.path === "/api/playlists")
			return Promise.resolve(Response.json({ playlists: [] }));
		return Promise.resolve(new Response(null, { status: 204 }));
	};

class MemoryStorage implements Storage {
	readonly #items = new Map<string, string>();

	get length() {
		return this.#items.size;
	}

	clear() {
		this.#items.clear();
	}

	getItem(key: string) {
		return this.#items.get(key) ?? null;
	}

	key(index: number) {
		return [...this.#items.keys()][index] ?? null;
	}

	removeItem(key: string) {
		this.#items.delete(key);
	}

	setItem(key: string, value: string) {
		this.#items.set(key, String(value));
	}
}

class RefusingStorage extends MemoryStorage {
	override setItem(): void {
		throw new DOMException("quota", "QuotaExceededError");
	}
}

const withStorage = (t: TestContext, storage: Storage) => {
	Object.assign(globalThis, { sessionStorage: storage });
	t.after(() => {
		Reflect.deleteProperty(globalThis, "sessionStorage");
	});
	return storage;
};

const storedValue = (storage: Storage) => {
	const raw = storage.getItem(SESSION_KEY);
	return raw === null ? null : JSON.parse(raw);
};

const polling = async (t: TestContext, respond: Answer) => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	asked = [];
	answer = respond;
	const client = new QueryClient();
	const stop = startPlayerPoll(client, ORIGIN, CAPABILITIES);

	t.after(async () => {
		stop();
		commitSession(ON_PLAYER);
		await settle();
		answer = outsideACase;
		client.clear();
		mock.timers.reset();
	});
	await settle();

	return {
		client,
		answers: (next: Answer) => {
			answer = next;
		},
		tick: async () => {
			mock.timers.tick(1000);
			await settle();
		},
		statesAskedFrom: (from: number) =>
			asked.slice(from).filter((one) => one.path === "/api/state"),
		queueReadsFrom: (from: number) =>
			asked.slice(from).filter((one) => one.path === "/api/queue").length,
		mark: () => asked.length,
	};
};

const drawnPath = (client: QueryClient) =>
	playingTrack(client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player)?.path ??
	null;

const drawnQueue = (client: QueryClient) =>
	(client.getQueryData<QueueRead>(QUEUE_KEY)?.entries ?? []).map(
		(entry) => entry.title,
	);

const thisDevice = (session: string) => ({
	session,
	deviceId: deviceId(),
});

test("entering a session scopes the very next poll to it and this device, and going back to the player unscopes it", async (t) => {
	const poll = await polling(
		t,
		withReads(() => answered(stateDocument({}), '"p"')),
	);

	const enteredAt = poll.mark();
	commitSession({ id: FIRST, role: "controlling" });

	assert.deepEqual(sessionScope(), thisDevice(FIRST));
	await settle();
	const atEntering = poll.statesAskedFrom(enteredAt);
	assert.ok(atEntering.length > 0, "nothing was asked at the commit");
	assert.deepEqual(
		atEntering.map(({ session, deviceId }) => ({ session, deviceId })),
		atEntering.map(() => thisDevice(FIRST)),
	);

	const leftAt = poll.mark();
	commitSession(ON_PLAYER);

	assert.equal(sessionScope(), null);
	await poll.tick();
	const afterLeaving = poll.statesAskedFrom(leftAt);
	assert.ok(afterLeaving.length > 0, "nothing was asked after leaving");
	assert.deepEqual(
		afterLeaving.map(({ session, deviceId }) => ({ session, deviceId })),
		afterLeaving.map(() => ({ session: null, deviceId: null })),
	);
});

test("a second session answering the first one's validator and queue revision still draws its own track and queue", async (t) => {
	let secondAsked = 0;
	const poll = await polling(
		t,
		withReads(
			(one) => {
				if (one.session === FIRST)
					return answered(
						stateDocument({
							path: FIRST_TRACK,
							queueRevision: ONE_QUEUE_REVISION,
						}),
						ONE_TAG,
					);
				if (one.session === SECOND) {
					secondAsked += 1;
					if (secondAsked === 1)
						return Promise.reject(new TypeError("dropped"));
					return one.ifNoneMatch === ONE_TAG
						? notModified()
						: answered(
								stateDocument({
									path: SECOND_TRACK,
									queueRevision: ONE_QUEUE_REVISION,
								}),
								ONE_TAG,
							);
				}
				return answered(stateDocument({}), '"p"');
			},
			{ [FIRST]: ["One"], [SECOND]: ["Four"] },
		),
	);

	commitSession({ id: FIRST, role: "controlling" });
	await poll.tick();
	assert.equal(drawnPath(poll.client), FIRST_TRACK);
	assert.deepEqual(drawnQueue(poll.client), ["One"]);

	commitSession({ id: SECOND, role: "controlling" });
	await poll.tick();
	await poll.tick();

	assert.ok(secondAsked > 1, "the second session was asked only once");
	assert.equal(drawnPath(poll.client), SECOND_TRACK);
	assert.deepEqual(drawnQueue(poll.client), ["Four"]);
});

test("until the session switched to first answers, no track and no queue row is drawn, and the player's volume stays", async (t) => {
	const poll = await polling(
		t,
		withReads(
			(one) =>
				one.session === SECOND
					? never()
					: answered(
							stateDocument({
								path: FIRST_TRACK,
								queueRevision: ONE_QUEUE_REVISION,
							}),
							ONE_TAG,
						),
			{ [FIRST]: ["One"] },
		),
	);

	commitSession({ id: FIRST, role: "controlling" });
	await poll.tick();
	assert.equal(drawnPath(poll.client), FIRST_TRACK);
	assert.deepEqual(drawnQueue(poll.client), ["One"]);

	commitSession({ id: SECOND, role: "controlling" });
	await settle();

	assert.equal(drawnPath(poll.client), null);
	assert.deepEqual(drawnQueue(poll.client), []);
	const volume =
		poll.client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player.volume;
	assert.deepEqual(
		volume && { value: volume.value, min: volume.min, max: volume.max },
		{
			value: PLAYER_VOLUME,
			min: CAPABILITIES.volumeMin,
			max: CAPABILITIES.volumeMax,
		},
	);
});

test("an answer asked for before a switch and arriving after it draws nothing and reads nothing", async (t) => {
	let release: (response: Response) => void = () => {};
	let holding = false;
	const poll = await polling(
		t,
		withReads(
			(one) => {
				if (one.session === SECOND) return never();
				if (holding)
					return new Promise<Response>((resolve) => {
						release = resolve;
					});
				return answered(
					stateDocument({
						path: FIRST_TRACK,
						queueRevision: ONE_QUEUE_REVISION,
					}),
					ONE_TAG,
				);
			},
			{ [FIRST]: ["One"] },
		),
	);

	commitSession({ id: FIRST, role: "controlling" });
	await poll.tick();
	assert.equal(drawnPath(poll.client), FIRST_TRACK);

	holding = true;
	await poll.tick();
	commitSession({ id: SECOND, role: "controlling" });
	await settle();
	const switchedAt = poll.mark();

	release(
		Response.json(
			stateDocument({
				path: "/music/First session/02 Two.flac",
				queueRevision: ONE_QUEUE_REVISION + 1,
			}),
			{ headers: { ETag: '"t-later"' } },
		),
	);
	await settle();

	assert.equal(drawnPath(poll.client), null);
	assert.equal(poll.queueReadsFrom(switchedAt), 0);
});

test("a poll naming this tab's session answered 404 puts the tab back on the player, says the session ended, and forgets the stored value", async (t) => {
	const storage = withStorage(t, new MemoryStorage());
	const poll = await polling(
		t,
		withReads((one) =>
			one.session === FIRST
				? noSuchSession()
				: answered(stateDocument({ path: PLAYER_TRACK }), '"p"'),
		),
	);

	commitSession({ id: FIRST, role: "listening" });
	await settle();

	assert.deepEqual(sessionSnapshot(), {
		id: null,
		role: null,
		notice: { kind: "ended", id: FIRST },
	});
	assert.equal(sessionScope(), null);
	assert.equal(storedValue(storage), null);

	const backAt = poll.mark();
	await poll.tick();
	const after404 = poll.statesAskedFrom(backAt);
	assert.ok(after404.length > 0, "the poll stopped after the 404");
	assert.deepEqual(
		after404.map((one) => one.session),
		after404.map(() => null),
	);
	assert.equal(drawnPath(poll.client), PLAYER_TRACK);
});

test("a 404 to a poll asked in a session already left does not move the tab out of the one it is in", async (t) => {
	let release: (response: Response) => void = () => {};
	await polling(
		t,
		withReads((one) => {
			if (one.session === FIRST)
				return new Promise<Response>((resolve) => {
					release = resolve;
				});
			if (one.session === SECOND)
				return answered(stateDocument({ path: SECOND_TRACK }), '"s2"');
			return answered(stateDocument({}), '"p"');
		}),
	);

	commitSession({ id: FIRST, role: "controlling" });
	await settle();
	commitSession({ id: SECOND, role: "controlling" });
	await settle();

	release(Response.json({ error: "no such session" }, { status: 404 }));
	await settle();

	assert.deepEqual(sessionSnapshot(), {
		id: SECOND,
		role: "controlling",
		notice: null,
	});
	assert.deepEqual(sessionScope(), thisDevice(SECOND));
});

test("a 404 on a read other than the poll leaves the tab in its session", async (t) => {
	const poll = await polling(t, (one) => {
		if (one.path === "/api/queue") return noSuchSession();
		if (one.path === "/api/state")
			return answered(
				stateDocument({ path: FIRST_TRACK, queueRevision: 1 }),
				ONE_TAG,
			);
		return Promise.resolve(Response.json({ playlists: [] }));
	});

	commitSession({ id: FIRST, role: "controlling" });
	await poll.tick();
	await poll.tick();

	assert.ok(poll.queueReadsFrom(0) > 0, "the queue was never read");
	assert.equal(sessionSnapshot().id, FIRST);
});

test("a session reported gone that this tab is not in changes nothing", (t) => {
	t.after(() => {
		commitSession(ON_PLAYER);
	});
	commitSession({ id: FIRST, role: "controlling" });
	const before = sessionSnapshot();

	noteSessionGone(SECOND);

	assert.equal(sessionSnapshot(), before);
	assert.deepEqual(sessionScope(), thisDevice(FIRST));
});

test("the state read tells a 404 apart as no such session", async (t) => {
	answer = noSuchSession;
	t.after(() => {
		answer = outsideACase;
	});

	const read = await fetchState(ORIGIN, null);

	assert.equal(read.ok, false);
	assert.equal(!read.ok && read.reason, "noSuchSession");
});

test("what was heard in the session left is forgotten at a switch, so the next session's first track is new even on the same path and second", async (t) => {
	const SHARED_PATH = "/music/Both sessions/07 Seven.flac";
	const poll = await polling(
		t,
		withReads((one) =>
			one.session === FIRST
				? answered(
						stateDocument({
							path: SHARED_PATH,
							playback: "paused",
							position: { seconds: 100, ageSeconds: 0 },
						}),
						ONE_TAG,
					)
				: never(),
		),
	);

	commitSession({ id: FIRST, role: "controlling" });
	await poll.tick();
	const heard = poll.client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
	assert.equal(playingTrack(heard?.player)?.path, SHARED_PATH);

	commitSession({ id: SECOND, role: "controlling" });
	await settle();

	assert.ok(heard);
	assert.equal(
		rememberSnapshot({ ...heard, syncedAt: performance.now() }),
		true,
		"the second session's track was read as the first session's, carrying on",
	);
});

test("the stored value is written on entering a session, rewritten on a change of role, and removed on going back to the player", (t) => {
	const storage = withStorage(t, new MemoryStorage());
	t.after(() => {
		commitSession(ON_PLAYER);
	});

	commitSession({ id: FIRST, role: "listening" });
	assert.deepEqual(storedValue(storage), { id: FIRST, listening: true });

	commitSession({ id: FIRST, role: "controlling" });
	assert.deepEqual(storedValue(storage), { id: FIRST, listening: false });

	commitSession({ id: SECOND, role: "listening" });
	assert.deepEqual(storedValue(storage), { id: SECOND, listening: true });

	commitSession(ON_PLAYER);
	assert.equal(storedValue(storage), null);
});

test("a stored value the browser refuses to write leaves the tab in the session it entered", (t) => {
	withStorage(t, new RefusingStorage());
	t.after(() => {
		commitSession(ON_PLAYER);
	});

	commitSession({ id: FIRST, role: "listening" });

	assert.equal(sessionSnapshot().id, FIRST);
	assert.equal(inSession(), true);
	assert.deepEqual(sessionScope(), thisDevice(FIRST));
});

test("the epoch moves when the session changes and on nothing else", (t) => {
	t.after(() => {
		commitSession(ON_PLAYER);
	});
	commitSession(ON_PLAYER);
	const start = sessionEpoch();

	const steps: [Parameters<typeof commitSession>[0], number][] = [
		[{ id: FIRST, role: "listening" }, 1],
		[{ id: FIRST, role: "controlling" }, 1],
		[{ id: FIRST, role: "controlling" }, 1],
		[{ id: SECOND, role: "controlling" }, 2],
		[ON_PLAYER, 3],
		[ON_PLAYER, 3],
	];

	assert.deepEqual(
		steps.map(([next]) => {
			commitSession(next);
			return sessionEpoch() - start;
		}),
		steps.map(([, moved]) => moved),
	);
});

test("the snapshot keeps its identity between commits, and a commit hands every subscriber a new one", (t) => {
	t.after(() => {
		commitSession(ON_PLAYER);
	});
	commitSession({ id: FIRST, role: "listening" });
	const held = sessionSnapshot();
	assert.equal(sessionSnapshot(), held);

	const seen: SessionModule.SessionSnapshot[] = [];
	const unsubscribe = subscribeSession(() => {
		seen.push(sessionSnapshot());
	});
	t.after(unsubscribe);

	commitSession({ id: FIRST, role: "controlling" });

	assert.equal(seen.length, 1);
	assert.notEqual(seen[0], held);
	assert.deepEqual(seen[0], { id: FIRST, role: "controlling", notice: null });
	assert.equal(sessionSnapshot(), seen[0]);
});

// Node keys a module by its whole URL, query included, so a fresh query loads a fresh `session.ts`.
let loads = 0;
const loadWithStored = async (
	t: TestContext,
	storage: Storage | null,
): Promise<typeof SessionModule> => {
	if (storage) withStorage(t, storage);
	t.after(() => {
		setSessionScope(null);
	});
	asked = [];
	answer = outsideACase;
	loads += 1;
	const url = new URL("../../src/domain/player/session.ts", import.meta.url);
	url.search = `load=${loads}`;
	return import(url.href);
};

const storing = (raw: string) => {
	const storage = new MemoryStorage();
	storage.setItem(SESSION_KEY, raw);
	return storage;
};

test("a stored session is taken up at load with its role, scoped before anything is sent, and stored as it was", async (t) => {
	const raw = JSON.stringify({ id: FIRST, listening: true });
	const storage = storing(raw);

	const loaded = await loadWithStored(t, storage);
	await settle();

	assert.deepEqual(loaded.sessionSnapshot(), {
		id: FIRST,
		role: "listening",
		notice: null,
	});
	assert.deepEqual(sessionScope(), thisDevice(FIRST));
	assert.equal(storage.getItem(SESSION_KEY), raw);
	assert.deepEqual(asked, [], "loading the store sent a request");
});

const NOT_A_SESSION: [string, string][] = [
	["not JSON", "{id:"],
	["JSON null", "null"],
	["a bare id", JSON.stringify(FIRST)],
	["an empty id", JSON.stringify({ id: "", listening: false })],
	["no role", JSON.stringify({ id: FIRST })],
	["a role that is not a boolean", JSON.stringify({ id: FIRST, listening: 1 })],
	["an id that is not a string", JSON.stringify({ id: 7, listening: false })],
	[
		"the player's own session",
		JSON.stringify({ id: "engine", listening: true }),
	],
];

for (const [what, raw] of NOT_A_SESSION) {
	test(`a stored value holding ${what} starts the tab on the player and is removed`, async (t) => {
		const storage = storing(raw);

		const loaded = await loadWithStored(t, storage);

		assert.deepEqual(loaded.sessionSnapshot(), {
			id: null,
			role: null,
			notice: null,
		});
		assert.equal(loaded.inSession(), false);
		assert.equal(sessionScope(), null);
		assert.equal(storage.getItem(SESSION_KEY), null);
	});
}

test("a tab with no sessionStorage starts on the player", async (t) => {
	const loaded = await loadWithStored(t, null);

	assert.deepEqual(loaded.sessionSnapshot(), {
		id: null,
		role: null,
		notice: null,
	});
	assert.equal(sessionScope(), null);
});
