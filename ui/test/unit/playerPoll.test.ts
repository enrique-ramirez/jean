import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
	keepPollOwned,
	POLL_MS,
	startPlayerPoll,
	VOLUME_SETTLE_MS,
} from "../../src/domain/player/playerPoll.ts";
import { volumePercent } from "../../src/domain/player/volumeScale.ts";
import type {
	FooJeanCapabilities,
	StateDocument,
} from "../../src/shared/api/fooJean.ts";
import type {
	PlayerSnapshot,
	PlayerState,
} from "../../src/shared/api/types.ts";

// `player-poll.spec.ts` drives the status bar against the fake, which is the
// user-visible half. What stays here is the request the browser cannot be asked
// about: how many go out, what validator they carry, and whether a tab nobody is
// looking at keeps asking. So is the order the two writers of the player key land
// in, since no browser can be asked for a subscription push at a chosen moment
// after a tick.

const ORIGIN = "http://player.invalid:8881";
const TOKEN = "token";
const STATE_PATH = "/api/state";
const PLAYER_KEY = ["player"];

const TAG = '"s1-r4-p7"';

type PlayerSection = StateDocument["player"];
type Playback = PlayerSection["playback"];

const stateDocument = (
	playback: Playback,
	player: Partial<PlayerSection> = {},
): StateDocument => ({
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
		playbackMode: "inOrder",
		...player,
	},
});

const document200 = (
	playback: Playback,
	tag: string | null = TAG,
	player: Partial<PlayerSection> = {},
) =>
	Promise.resolve(
		new Response(JSON.stringify(stateDocument(playback, player)), {
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

const playerIn = (client: QueryClient) =>
	client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player ?? null;

const playbackIn = (client: QueryClient) =>
	playerIn(client)?.playbackState ?? null;

const CAPABILITIES = {
	apiVersion: 1,
	allowedFields: ["rating"],
	canWrite: true,
	canWritePlaylists: false,
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
} satisfies FooJeanCapabilities;

const NOW_PLAYING = ["One", "Babasónicos", "Jessico"];

// beefweb's own update payload, which has no key for `jeanPlaybackMode` at all and
// answers `permissions` from beefweb's configuration rather than the component's.
const subscriptionPush = (over: Partial<PlayerState> = {}) =>
	({
		activeItem: {
			columns: NOW_PLAYING,
			duration: 214,
			index: 3,
			playlistId: "p7",
			playlistIndex: 1,
			position: 12,
		},
		info: {
			name: "foobar2000",
			title: "beefweb",
			version: "2.24.5",
			pluginVersion: "0.10",
		},
		options: [
			{ id: "playbackOrder", name: "Playback order", type: "enum", value: 0 },
		],
		permissions: {
			changePlaylists: true,
			changeOutput: true,
			changeClientConfig: true,
		},
		playbackMode: 0,
		playbackModes: ["Default", "Shuffle (tracks)"],
		playbackState: "playing",
		volume: { type: "db", min: -100, max: 0, value: -6, isMuted: false },
		...over,
	}) as PlayerState;

// What `usePlayerStream` does with a message's `player` section. The rest of it is an
// `EventSource` inside a React effect, and neither of those runs under `node`.
const pushFromSubscription = (client: QueryClient, player: PlayerState) => {
	const previous = client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
	client.setQueryData<PlayerSnapshot>(PLAYER_KEY, {
		player: keepPollOwned(previous?.player, player),
		syncedAt: performance.now(),
	});
};

const harness = (
	t: TestContext,
	first: Answer,
	capabilities?: FooJeanCapabilities,
) => {
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
	const stop = startPlayerPoll(client, ORIGIN, TOKEN, capabilities);

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

test("a tick draws the player's name, the fader's range and what the install permits from capabilities", async (t) => {
	const poll = harness(
		t,
		() => document200("playing", TAG, { volume: -6 }),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.deepEqual(player?.volume, {
		type: "db",
		min: -100,
		max: 0,
		value: -6,
		isMuted: false,
	});
	assert.deepEqual(player?.permissions, {
		changePlaylists: false,
		changeOutput: false,
		changeClientConfig: true,
	});
	assert.equal(player?.info.name, "foobar2000");
	assert.equal(player?.info.version, "2.24.5");
});

test("a subscription push leaves the permissions and the playback order the poll wrote", async (t) => {
	const poll = harness(
		t,
		() => document200("playing", TAG, { playbackMode: "shuffleTracks" }),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	pushFromSubscription(poll.client, subscriptionPush());

	const player = playerIn(poll.client);

	assert.equal(
		player?.jeanPlaybackMode,
		"shuffleTracks",
		"the push blanked the playback order",
	);
	assert.equal(
		player?.permissions.changePlaylists,
		false,
		"the push blanked what the component said about writing playlists",
	);
	assert.equal(
		player?.permissions.changeOutput,
		false,
		"the push blanked what the component said about the output",
	);
});

test("a subscription push still delivers the playing track, the transport and the level", async (t) => {
	const poll = harness(
		t,
		() => document200("paused", TAG, { volume: -40 }),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	assert.deepEqual(playerIn(poll.client)?.activeItem.columns, []);

	pushFromSubscription(poll.client, subscriptionPush());

	const player = playerIn(poll.client);

	assert.deepEqual(player?.activeItem.columns, NOW_PLAYING);
	assert.equal(player?.activeItem.playlistId, "p7");
	assert.equal(player?.playbackState, "playing");
	assert.equal(player?.volume.value, -6);
});

test("a tick leaves the playing track, the option list and beefweb's own fields alone", async (t) => {
	const poll = harness(t, () => document200("playing"), CAPABILITIES);
	await poll.settle();
	await poll.ticks(1);
	pushFromSubscription(poll.client, subscriptionPush());

	poll.answers(() =>
		document200("paused", TAG, { position: { seconds: 30, ageSeconds: 0 } }),
	);
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.deepEqual(player?.activeItem.columns, NOW_PLAYING);
	assert.equal(player?.activeItem.playlistId, "p7");
	assert.equal(player?.activeItem.index, 3);
	assert.equal(player?.info.title, "beefweb");
	assert.deepEqual(player?.playbackModes, ["Default", "Shuffle (tracks)"]);
	assert.equal(player?.options?.[0]?.id, "playbackOrder");

	assert.equal(player?.playbackState, "paused");
	assert.equal(player?.activeItem.position, 30);
});

test("a push before any tick has landed is taken whole", async (t) => {
	const poll = harness(t, never, CAPABILITIES);
	await poll.settle();
	assert.equal(playerIn(poll.client), null);

	pushFromSubscription(
		poll.client,
		subscriptionPush({
			permissions: {
				changePlaylists: false,
				changeOutput: true,
				changeClientConfig: true,
			},
		}),
	);

	const player = playerIn(poll.client);

	assert.deepEqual(player?.activeItem.columns, NOW_PLAYING);
	assert.equal(player?.playbackState, "playing");
	assert.deepEqual(player?.permissions, {
		changePlaylists: false,
		changeOutput: true,
		changeClientConfig: true,
	});
});

test("a tick before capabilities have landed reports the level with no range to draw it in", async (t) => {
	// `GET /api/capabilities` is read once and the poll may tick first. A guessed range
	// puts the thumb in the wrong place along the fader's whole length, and a guessed
	// permission greys out a control this install may well allow.
	const poll = harness(t, () => document200("playing", TAG, { volume: -6 }));
	await poll.settle();
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.equal(player?.volume.value, -6);
	assert.equal(volumePercent(player?.volume), 0);
	assert.deepEqual(player?.permissions, {
		changePlaylists: true,
		changeOutput: true,
		changeClientConfig: true,
	});
});
