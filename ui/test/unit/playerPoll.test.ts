import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
	POLL_MS,
	startPlayerPoll,
	VOLUME_SETTLE_MS,
} from "../../src/domain/player/playerPoll.ts";
import { volumePercent } from "../../src/domain/player/volumeScale.ts";
import type {
	FooJeanCapabilities,
	StateDocument,
} from "../../src/shared/api/fooJean.ts";
import { readTrack } from "../../src/shared/api/playerState.ts";
import type {
	PlayerSnapshot,
	PlayerState,
} from "../../src/shared/api/types.ts";

// `player-poll.spec.ts` drives the status bar against the fake, which is the
// user-visible half. What stays here is the request the browser cannot be asked
// about: how many go out, what validator they carry, and whether a tab nobody is
// looking at keeps asking. So is what a tick does to a key that already holds
// something, since no browser can be asked to put a value there at a chosen
// moment before one.

const ORIGIN = "http://player.invalid:8881";
const TOKEN = "token";
const STATE_PATH = "/api/state";
const PLAYER_KEY = ["player"];

const TAG = '"s1-r4-p7"';
const LATER_TAG = '"s1-r4-p8"';

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
		title: null,
		artist: null,
		playingLocation: null,
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

const NAME = { artist: "Babasónicos", title: "One" };

const DISC_IMAGE = "/music/Artist/Album/Whole Disc.flac";
const DISC_SUBSONG = 3;

const PLAYING_FROM = {
	playlistId: "45837d74-fa4f-415c-bba9-bf2db8f0dc04",
	index: 5,
};

// Whatever the key holds when a tick lands: an optimistic patch Jean wrote for a
// press it has not seen confirmed, or the tick before this one. Every field
// disagrees with the documents below, so an assertion cannot pass on this by
// accident.
const held = (over: Partial<PlayerState> = {}): PlayerState => ({
	activeItem: {
		columns: ["Someone else", "Another song"],
		duration: 214,
		index: 3,
		path: "/music/Other/Album/03 Three.flac",
		playlistGuid: "8c4b4a3e-6f1e-4d2a-9d55-5f6d5b0a1c22",
		playlistId: "p7",
		playlistIndex: 1,
		position: 99,
		subsong: 2,
	},
	info: {
		name: "another player",
		version: "0.0",
	},
	permissions: {
		changeOutput: true,
		changeClientConfig: true,
	},
	jeanPlaybackMode: "repeatOne",
	playbackState: "stopped",
	volume: { type: "linear", min: 0, max: 100, value: 80, isMuted: true },
	...over,
});

const putInKey = (client: QueryClient, player: PlayerState) =>
	client.setQueryData<PlayerSnapshot>(PLAYER_KEY, {
		player,
		syncedAt: performance.now(),
	});

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

	poll.answers(() => document200("playing", LATER_TAG));
	await poll.ticks(1);

	assert.equal(playbackIn(poll.client), "playing");
});

test("the playing track's name, path and subsong all come from the tick's document", async (t) => {
	const poll = harness(
		t,
		() =>
			document200("playing", TAG, {
				...NAME,
				path: DISC_IMAGE,
				subsong: DISC_SUBSONG,
			}),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	const track = readTrack(playerIn(poll.client));

	assert.equal(track?.artist, NAME.artist);
	assert.equal(track?.title, NAME.title);
	assert.equal(track?.path, DISC_IMAGE);
	// The other half of a track's identity for a cue sheet or a disc image. A
	// subsong that never arrives reads as `0`, which is an ordinary whole file.
	assert.equal(track?.subsong, DISC_SUBSONG);
});

test("a tick naming nothing does not draw the previous track's name on the new path", async (t) => {
	// Criterion 24: a window where the path is the new track and the name is the old one is the
	// same defect a tick wide. `title` and `artist` are on the document every tick, so a tick that
	// answers `null` for both is the component saying this track has no computed name yet, not the
	// component staying silent about the one it already gave.
	const poll = harness(
		t,
		() => document200("playing", TAG, { ...NAME, path: DISC_IMAGE }),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	assert.equal(readTrack(playerIn(poll.client))?.artist, NAME.artist);

	poll.answers(() =>
		document200("playing", LATER_TAG, {
			path: "/music/Other/Album/03 Three.flac",
		}),
	);
	await poll.ticks(1);

	const track = readTrack(playerIn(poll.client));

	assert.notEqual(track?.artist, NAME.artist);
	assert.notEqual(track?.title, NAME.title);
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

	poll.answers(() => document200("playing", LATER_TAG));
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
		changeOutput: false,
		changeClientConfig: true,
	});
	assert.equal(player?.info.name, "foobar2000");
	assert.equal(player?.info.version, "2.24.5");
});

test("a tick overwrites everything its document speaks for, whoever put the previous value there", async (t) => {
	// The player key has one writer besides Jean's own optimistic patches, so a
	// value in it that no document fed is a guess the next tick settles. A field
	// that outlives a tick is a second writer's, and reconciling two of them is
	// what this poll stopped doing.
	const poll = harness(t, () => document200("stopped"), CAPABILITIES);
	await poll.settle();

	putInKey(poll.client, held());

	poll.answers(() =>
		document200("playing", LATER_TAG, {
			...NAME,
			path: DISC_IMAGE,
			subsong: DISC_SUBSONG,
			position: { seconds: 12, ageSeconds: 1 },
			playbackMode: "shuffleTracks",
			playingLocation: PLAYING_FROM,
		}),
	);
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.equal(player?.playbackState, "playing");
	assert.equal(player?.jeanPlaybackMode, "shuffleTracks");
	assert.deepEqual(player?.activeItem.columns, [NAME.artist, NAME.title]);
	assert.equal(player?.activeItem.path, DISC_IMAGE);
	assert.equal(player?.activeItem.subsong, DISC_SUBSONG);
	assert.equal(player?.activeItem.duration, 180);
	assert.equal(player?.activeItem.position, 13);
	assert.equal(player?.activeItem.index, PLAYING_FROM.index);
	assert.equal(player?.activeItem.playlistGuid, PLAYING_FROM.playlistId);
	assert.deepEqual(player?.volume, {
		type: "db",
		min: -100,
		max: 0,
		value: -6,
		isMuted: false,
	});
	assert.deepEqual(player?.permissions, {
		changeOutput: false,
		changeClientConfig: true,
	});
});

test("a tick writes what its document carries and leaves the rest of the snapshot standing", async (t) => {
	const poll = harness(t, () => document200("playing"), CAPABILITIES);
	await poll.settle();
	putInKey(poll.client, held());

	poll.answers(() =>
		document200("paused", TAG, { position: { seconds: 30, ageSeconds: 0 } }),
	);
	await poll.ticks(1);

	const player = playerIn(poll.client);

	// The document carries `title` and `artist` on every tick, even when both are `null`, so the name
	// is written rather than held: `playlistId` is the field this test is really about, since nothing
	// in `mergePlayer` sets it from the document at all.
	assert.deepEqual(player?.activeItem.columns, ["", ""]);
	assert.equal(player?.activeItem.playlistId, "p7");

	assert.equal(player?.playbackState, "paused");
	assert.equal(player?.activeItem.position, 30);
});

test("a tick reporting no place drops the place, rather than leaving the last one standing", async (t) => {
	// `foo_jean` publishes `playingLocation: null` once the playing item is gone from the
	// playlist it started in. Carrying the previous location forward points the equaliser at
	// whatever row slid into that index, under the name of a playlist the track has left.
	const poll = harness(
		t,
		() => document200("playing", TAG, { playingLocation: PLAYING_FROM }),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	const playing = playerIn(poll.client)?.activeItem;

	assert.equal(playing?.index, PLAYING_FROM.index);
	assert.equal(playing?.playlistGuid, PLAYING_FROM.playlistId);

	poll.answers(() => document200("playing", LATER_TAG));
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.equal(
		player?.activeItem.index,
		-1,
		"the poll kept an index for a row the track has left",
	);
	assert.equal(
		player?.activeItem.playlistGuid,
		null,
		"the poll went on naming a playlist the track has left",
	);
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
		changeOutput: true,
		changeClientConfig: true,
	});
});
