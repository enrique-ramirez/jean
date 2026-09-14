import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
	POLL_MS,
	startPlayerPoll,
	VOLUME_SETTLE_MS,
} from "../../src/domain/player/playerPoll.ts";
import type { StateDocument } from "../../src/shared/api/fooJean.ts";
import type { PlayerSnapshot } from "../../src/shared/api/types.ts";

// `player-poll.spec.ts` drives the status bar against the fake, which is the
// user-visible half. What stays here is the request the browser cannot be asked
// about: how many go out, what validator they carry, and whether a tab nobody is
// looking at keeps asking.

const ORIGIN = "http://player.invalid:8881";
const TOKEN = "token";
const STATE_PATH = "/api/state";
const PLAYER_KEY = ["player"];

const TAG = '"s1-r4-p7"';

type Playback = StateDocument["player"]["playback"];

const stateDocument = (playback: Playback): StateDocument => ({
	library: {
		ready: true,
		structure: 1,
		revision: 4,
		trackCount: 3,
		columns: ["%title%"],
	},
	player: {
		playback,
		path: "Artist/Album/01 One.flac",
		subsong: 0,
		position: { seconds: 12, ageSeconds: 0 },
		duration: 180,
		volume: -6,
		muted: false,
		playbackOrder: 0,
	},
});

const document200 = (playback: Playback, tag: string | null = TAG) =>
	Promise.resolve(
		new Response(JSON.stringify(stateDocument(playback)), {
			headers: tag
				? { "Content-Type": "application/json", ETag: tag }
				: { "Content-Type": "application/json" },
		}),
	);

const unchanged = () => Promise.resolve(new Response(null, { status: 304 }));

const never = () => new Promise<Response>(() => {});

interface Call {
	url: string;
	ifNoneMatch: string | null;
}

type Answer = (ifNoneMatch: string | null) => Promise<Response>;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const playbackIn = (client: QueryClient) =>
	client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player?.playbackState ??
	null;

const harness = (t: TestContext, first: Answer) => {
	const realFetch = globalThis.fetch;
	const realDocument = globalThis.document;

	mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });

	const calls: Call[] = [];
	let answer = first;

	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");
		calls.push({ url: String(input), ifNoneMatch });
		return answer(ifNoneMatch);
	}) as typeof fetch;

	const watchers = new Set<() => void>();
	let visibility: "visible" | "hidden" = "visible";
	const change = (next: typeof visibility) => {
		visibility = next;
		for (const watcher of [...watchers]) watcher();
	};

	globalThis.document = {
		get visibilityState() {
			return visibility;
		},
		get hidden() {
			return visibility === "hidden";
		},
		addEventListener: (type: string, watcher: () => void) => {
			if (type === "visibilitychange") watchers.add(watcher);
		},
		removeEventListener: (type: string, watcher: () => void) => {
			if (type === "visibilitychange") watchers.delete(watcher);
		},
	} as unknown as Document;

	const client = new QueryClient();
	const stop = startPlayerPoll(client, ORIGIN, TOKEN);

	t.after(() => {
		stop();
		client.clear();
		mock.timers.reset();
		globalThis.fetch = realFetch;
		globalThis.document = realDocument;
	});

	const settle = async () => {
		for (let step = 0; step < 3; step += 1) await flush();
	};

	return {
		client,
		calls,
		answers: (next: Answer) => {
			answer = next;
		},
		hide: () => change("hidden"),
		show: () => change("visible"),
		settle,
		ticks: async (count: number) => {
			for (let step = 0; step < count; step += 1) {
				mock.timers.tick(POLL_MS);
				await settle();
			}
		},
		stateCalls: () => calls.filter((call) => call.url.endsWith(STATE_PATH)),
	};
};

test("a tick writes what the component says the player is doing into the player key", async (t) => {
	const poll = harness(t, () => document200("paused"));
	await poll.settle();
	await poll.ticks(1);

	assert.equal(playbackIn(poll.client), "paused");

	poll.answers(() => document200("playing", '"s1-r4-p8"'));
	await poll.ticks(1);

	assert.equal(playbackIn(poll.client), "playing");
});

test("a reader of the player key is fed by the poll and never refetches for itself", async (t) => {
	const poll = harness(t, () => document200("paused"));
	await poll.settle();
	await poll.ticks(1);

	let readerFetched = 0;
	const reader = new QueryObserver(poll.client, {
		queryKey: PLAYER_KEY,
		queryFn: async () => {
			readerFetched += 1;
			return poll.client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
	const seen: (string | null)[] = [];
	const unsubscribe = reader.subscribe((result) => {
		seen.push(result.data?.player?.playbackState ?? null);
	});
	t.after(unsubscribe);

	poll.answers(() => document200("playing", '"s1-r4-p8"'));
	await poll.ticks(3);

	assert.equal(readerFetched, 0);
	assert.deepEqual(
		[...new Set(seen)],
		["playing"],
		"the reader was told something the poll did not write",
	);

	// Without this the zero above proves nothing: a reader that could not fetch
	// under `node` would report the same number.
	await poll.client.invalidateQueries({ queryKey: PLAYER_KEY });
	assert.equal(readerFetched, 1);
});

test("a tick that has not answered does not start a second request", async (t) => {
	// One request per tick against a player answering on one work queue is the
	// budget; wifi at the edge of a house is where a tick outlives its interval.
	const poll = harness(t, never);
	await poll.settle();
	await poll.ticks(3);

	assert.equal(poll.stateCalls().length, 1);
});

test("the poll interval is shorter than the volume settle window", () => {
	// A fader held through a tick is confirmed rather than sprung back to the
	// level the player last reported. The drag itself is `sliders.spec.ts`.
	assert.ok(
		POLL_MS < VOLUME_SETTLE_MS,
		`a tick every ${POLL_MS} ms lands inside a ${VOLUME_SETTLE_MS} ms settle`,
	);
});

test("the poll holds the validator between ticks, and a 304 leaves the cache alone", async (t) => {
	const poll = harness(t, () => document200("playing"));
	await poll.settle();
	await poll.ticks(1);

	poll.answers((ifNoneMatch) =>
		ifNoneMatch === TAG ? unchanged() : document200("stopped", null),
	);
	await poll.ticks(2);

	const asked = poll.stateCalls();
	assert.equal(asked.at(-1)?.ifNoneMatch, TAG);
	assert.equal(playbackIn(poll.client), "playing");
});

test("a hidden tab stops asking, and asks again when it comes back", async (t) => {
	const poll = harness(t, () => document200("playing"));
	await poll.settle();
	await poll.ticks(1);

	poll.hide();
	await poll.settle();
	const askedWhileVisible = poll.stateCalls().length;
	await poll.ticks(3);

	assert.equal(poll.stateCalls().length, askedWhileVisible);

	poll.show();
	await poll.ticks(1);

	assert.ok(
		poll.stateCalls().length > askedWhileVisible,
		"coming back to the tab did not resume the poll",
	);
});
