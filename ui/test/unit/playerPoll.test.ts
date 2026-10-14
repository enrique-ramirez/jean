import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
	configureListening,
	connect,
	disconnect,
} from "../../src/domain/player/listenerStore.ts";
import * as playerPoll from "../../src/domain/player/playerPoll.ts";
import {
	POLL_MS,
	pollPlayerNow,
	startPlayerPoll,
	VOLUME_SETTLE_MS,
} from "../../src/domain/player/playerPoll.ts";
import { volumePercent } from "../../src/domain/player/volumeScale.ts";
import type { FooJeanCapabilities } from "../../src/shared/api/discovery.ts";
import { playingTrack } from "../../src/shared/api/playerState.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import type {
	PlaybackMode,
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
		build: null,
		halted: false,
	},
	configGeneration: 0,
	mainThread: { answering: true, unansweredSeconds: null },
	player: {
		playback,
		path: "Artist/Album/01 One.flac",
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
		volume: -6,
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
	cache: RequestCache | undefined;
	at: number;
}

type Answer = (ifNoneMatch: string | null, url: string) => Promise<Response>;

// The reads a tick's revisions set off, answered the way an install with an empty queue and no
// playlists would, for a test whose subject is the state poll alone.
const stateOnly =
	(answer: Answer): Answer =>
	(ifNoneMatch, url) => {
		const path = new URL(url).pathname;
		if (path === "/api/playlists")
			return Promise.resolve(Response.json({ playlists: [] }));
		if (path === "/api/queue")
			return Promise.resolve(Response.json({ revision: 0, entries: [] }));
		return answer(ifNoneMatch, url);
	};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const STEP_MS = 10;

const playerIn = (client: QueryClient) =>
	client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player ?? null;

const playbackIn = (client: QueryClient) =>
	playerIn(client)?.playbackState ?? null;

const CAPABILITIES = {
	apiVersion: 1,
	allowedFields: ["rating"],
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
	maxSessions: 0,
	canCreateSessions: false,
} satisfies FooJeanCapabilities;

const NAME = { artist: "Babasónicos", title: "One" };

const DISC_IMAGE = "/music/Artist/Album/Whole Disc.flac";
const DISC_SUBSONG = 3;

const PLAYING_FROM = {
	playlistId: "45837d74-fa4f-415c-bba9-bf2db8f0dc04",
	index: 5,
};

// Opaque ids spelled the way `foo_jean` spells a real one, and different from each
// other, so nothing can pass by reading the wrong one.
const SPEAKERS =
	"D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:0B6E1C2D-3A4F-4B5C-8D9E-0F1A2B3C4D5E";
const HEADPHONES =
	"D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:7C8D9E0F-1A2B-4C3D-9E4F-5A6B7C8D9E0F";
const HELD_DEVICE =
	"00000000-0000-0000-0000-000000000000:11111111-1111-1111-1111-111111111111";

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
		libraryPath: "Other/Album/03 Three.flac",
		album: "Another album",
		albumArtist: "Someone else",
		playlistGuid: "8c4b4a3e-6f1e-4d2a-9d55-5f6d5b0a1c22",
		position: 99,
		subsong: 2,
	},
	info: {
		name: "another player",
		version: "0.0",
	},
	playbackMode: "repeatOne",
	outputDeviceId: HELD_DEVICE,
	outputSilent: true,
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

	globalThis.fetch = ((request: Request) => {
		const ifNoneMatch = request.headers.get("If-None-Match");
		calls.push({
			url: request.url,
			ifNoneMatch,
			cache: request.cache,
			at: Date.now(),
		});
		return answer(ifNoneMatch, request.url);
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
		body: { appendChild: (child: unknown) => child },
	} as unknown as Document;

	const client = new QueryClient();
	const stop = startPlayerPoll(client, ORIGIN, capabilities);
	const teardowns: (() => void)[] = [];

	const settle = async () => {
		for (let step = 0; step < 3; step += 1) await flush();
	};

	t.after(async () => {
		for (const teardown of teardowns) teardown();
		stop();
		client.clear();
		await settle();
		mock.timers.reset();
		globalThis.fetch = realFetch;
		globalThis.document = realDocument;
	});

	return {
		client,
		calls,
		atTeardown: (teardown: () => void) => teardowns.push(teardown),
		answersState: (next: Answer) => {
			answer = stateOnly(next);
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
		advance: async (ms: number) => {
			for (let passed = 0; passed < ms; passed += STEP_MS) {
				mock.timers.tick(STEP_MS);
				await settle();
			}
		},
		stateCalls: () => calls.filter((call) => call.url.endsWith(STATE_PATH)),
		callsTo: (path: string) =>
			calls.filter((call) => new URL(call.url).pathname === path).length,
	};
};

test("a tick writes what the component says the player is doing into the player key", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("paused")),
	);
	await poll.settle();
	await poll.ticks(1);

	assert.equal(playbackIn(poll.client), "paused");

	poll.answersState(() => document200("playing", LATER_TAG));
	await poll.ticks(1);

	assert.equal(playbackIn(poll.client), "playing");
});

test("the playing track's name, path and subsong all come from the tick's document", async (t) => {
	const poll = harness(
		t,
		stateOnly(() =>
			document200("playing", TAG, {
				...NAME,
				path: DISC_IMAGE,
				subsong: DISC_SUBSONG,
			}),
		),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	const track = playingTrack(playerIn(poll.client));

	assert.equal(track?.artist, NAME.artist);
	assert.equal(track?.title, NAME.title);
	assert.equal(track?.path, DISC_IMAGE);
	// The other half of a track's identity for a cue sheet or a disc image. A
	// subsong that never arrives reads as `0`, which is an ordinary whole file.
	assert.equal(track?.subsong, DISC_SUBSONG);
});

test("a tick naming nothing does not draw the previous track's name on the new path", async (t) => {
	// A window where the path is the new track and the name is the old one is the
	// same defect a tick wide. `title` and `artist` are on the document every tick, so a tick that
	// answers `null` for both is the component saying this track has no computed name yet, not the
	// component staying silent about the one it already gave.
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { ...NAME, path: DISC_IMAGE })),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	assert.equal(playingTrack(playerIn(poll.client))?.artist, NAME.artist);

	poll.answersState(() =>
		document200("playing", LATER_TAG, {
			path: "/music/Other/Album/03 Three.flac",
		}),
	);
	await poll.ticks(1);

	const track = playingTrack(playerIn(poll.client));

	assert.equal(track?.artist, null);
	assert.equal(track?.title, null);
});

test("a reader of the player key is fed by the poll and never refetches for itself", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("paused")),
	);
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

	poll.answersState(() => document200("playing", LATER_TAG));
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
	const poll = harness(t, stateOnly(never));
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
	const poll = harness(
		t,
		stateOnly(() => document200("playing")),
	);
	await poll.settle();
	await poll.ticks(1);

	poll.answersState((ifNoneMatch) =>
		ifNoneMatch === TAG ? unchanged() : document200("stopped", null),
	);
	await poll.ticks(2);

	const asked = poll.stateCalls();
	assert.equal(asked.at(-1)?.ifNoneMatch, TAG);
	assert.equal(playbackIn(poll.client), "playing");
});

test("no read of the player's state, tagged or not, can be answered from the browser's own cache", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing")),
	);
	await poll.settle();
	await poll.ticks(1);
	await pollPlayerNow(poll.client, ORIGIN);
	await poll.settle();

	const asked = poll.stateCalls();
	assert.ok(
		asked.some((call) => call.ifNoneMatch === null),
		"no untagged read went out",
	);
	assert.ok(
		asked.some((call) => call.ifNoneMatch === TAG),
		"no tagged read went out",
	);
	// A read carrying `If-None-Match` already forces a bypass of the browser's
	// own cache, under the Fetch standard's rule for conditional headers, so a
	// tagged read needs no `cache: "no-store"` of its own to get the same guarantee.
	for (const call of asked)
		assert.ok(
			call.ifNoneMatch !== null ||
				call.cache === "no-store" ||
				call.cache === "reload",
			`an untagged read left the browser free to answer from its cache (cache: ${call.cache})`,
		);
});

test("a hidden tab that is not listening stops asking, and asks again when it comes back", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing")),
	);
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

test("a tab coming back asks at once, rather than on the next tick", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing")),
	);
	await poll.settle();

	poll.hide();
	await poll.ticks(2);
	const askedWhileHidden = poll.stateCalls().length;

	poll.show();
	await poll.settle();

	assert.equal(poll.stateCalls().length, askedWhileHidden + 1);
});

test("a tick draws the player's name, the fader's range and what the install permits from capabilities", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { volume: -6 })),
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
	assert.equal(player?.info.name, "foobar2000");
	assert.equal(player?.info.version, "2.24.5");
});

test("a tick overwrites everything its document speaks for, whoever put the previous value there", async (t) => {
	// The player key has one writer besides Jean's own optimistic patches, so a
	// value in it that no document fed is a guess the next tick settles. A field
	// that outlives a tick is a second writer's, and reconciling two of them is
	// what this poll stopped doing.
	const poll = harness(
		t,
		stateOnly(() => document200("stopped")),
		CAPABILITIES,
	);
	await poll.settle();

	putInKey(poll.client, held());

	poll.answersState(() =>
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
	assert.equal(player?.playbackMode, "shuffleTracks");
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
});

test("a tick writes a name its document leaves empty, rather than holding the last one", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing")),
		CAPABILITIES,
	);
	await poll.settle();
	putInKey(poll.client, held());

	poll.answersState(() =>
		document200("paused", TAG, { position: { seconds: 30, ageSeconds: 0 } }),
	);
	await poll.ticks(1);

	const player = playerIn(poll.client);

	// The document carries `title` and `artist` on every tick, even when both are `null`.
	assert.deepEqual(player?.activeItem.columns, ["", ""]);

	assert.equal(player?.playbackState, "paused");
	assert.equal(player?.activeItem.position, 30);
});

test("a tick reporting no place drops the place, rather than leaving the last one standing", async (t) => {
	// `foo_jean` publishes `playingLocation: null` once the playing item is gone from the
	// playlist it started in. Carrying the previous location forward points the equaliser at
	// whatever row slid into that index, under the name of a playlist the track has left.
	const poll = harness(
		t,
		stateOnly(() =>
			document200("playing", TAG, { playingLocation: PLAYING_FROM }),
		),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);

	const playing = playerIn(poll.client)?.activeItem;

	assert.equal(playing?.index, PLAYING_FROM.index);
	assert.equal(playing?.playlistGuid, PLAYING_FROM.playlistId);

	poll.answersState(() => document200("playing", LATER_TAG));
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
	// puts the thumb in the wrong place along the fader's whole length.
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { volume: -6 })),
	);
	await poll.settle();
	await poll.ticks(1);

	const player = playerIn(poll.client);

	assert.equal(player?.volume.value, -6);
	assert.equal(volumePercent(player?.volume), 0);
});

test("a tick carries the output device the player is set to, and the next tick moves it", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { outputDeviceId: SPEAKERS })),
		CAPABILITIES,
	);
	await poll.settle();
	putInKey(poll.client, held());
	await poll.ticks(1);

	assert.equal(playerIn(poll.client)?.outputDeviceId, SPEAKERS);

	poll.answersState(() =>
		document200("playing", LATER_TAG, { outputDeviceId: HEADPHONES }),
	);
	await poll.ticks(1);

	assert.equal(playerIn(poll.client)?.outputDeviceId, HEADPHONES);
});

test("a tick naming no output device writes null, rather than keeping the last one", async (t) => {
	// `null` is the device foobar2000 is pointed at having been unplugged, or a component that
	// cannot ask. Holding the last id instead ticks a device the player has left.
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { outputDeviceId: SPEAKERS })),
		CAPABILITIES,
	);
	await poll.settle();
	await poll.ticks(1);
	assert.equal(playerIn(poll.client)?.outputDeviceId, SPEAKERS);

	poll.answersState(() =>
		document200("playing", LATER_TAG, { outputDeviceId: null }),
	);
	await poll.ticks(1);

	assert.strictEqual(playerIn(poll.client)?.outputDeviceId, null);
});

test("a tick before capabilities have landed still carries the output device", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { outputDeviceId: SPEAKERS })),
	);
	await poll.settle();
	await poll.ticks(1);

	assert.equal(playerIn(poll.client)?.outputDeviceId, SPEAKERS);
});

// `null` is foobar2000 set to no device the component can name, and reads as audible.
test("a tick carries whether the player's output is silent, true, false or null, and the next tick moves it", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { outputSilent: false })),
		CAPABILITIES,
	);
	await poll.settle();
	putInKey(poll.client, held());
	await poll.ticks(1);
	assert.strictEqual(playerIn(poll.client)?.outputSilent, false);

	for (const [tag, outputSilent] of [
		[LATER_TAG, true],
		['"s1-r4-p9"', null],
		['"s1-r4-p10"', false],
	] as const) {
		poll.answersState(() => document200("playing", tag, { outputSilent }));
		await poll.ticks(1);
		assert.strictEqual(playerIn(poll.client)?.outputSilent, outputSilent);
	}
});

test("a tick from a player that answers no outputSilent writes null, rather than keeping the last one", async (t) => {
	const older = () => {
		const { outputSilent: _, ...player } = stateDocument("playing").player;
		return Promise.resolve(
			Response.json(
				{ ...stateDocument("playing"), player },
				{ headers: { ETag: TAG } },
			),
		);
	};
	const poll = harness(t, stateOnly(older), CAPABILITIES);
	await poll.settle();
	putInKey(poll.client, held({ outputSilent: true }));
	await poll.ticks(1);

	assert.strictEqual(playerIn(poll.client)?.outputSilent, null);
});

test("a 304 tick hands the last announced revisions on again, so a failed queue or playlist read is retried", async (t) => {
	const REVISIONS = { queueRevision: 7301, playlistsRevision: 7302 };
	let reachable = false;
	const poll = harness(t, (ifNoneMatch, url) => {
		const path = new URL(url).pathname;
		if (path === STATE_PATH)
			return ifNoneMatch === TAG
				? unchanged()
				: document200("playing", TAG, REVISIONS);
		if (!reachable) return Promise.resolve(new Response(null, { status: 500 }));
		if (path === "/api/queue")
			return Promise.resolve(
				Response.json({ revision: REVISIONS.queueRevision, entries: [] }),
			);
		return Promise.resolve(Response.json({ playlists: [] }));
	});
	await poll.settle();

	assert.equal(poll.callsTo("/api/queue"), 1);
	assert.equal(poll.callsTo("/api/playlists"), 1);

	reachable = true;
	await poll.ticks(1);

	assert.equal(poll.stateCalls().at(-1)?.ifNoneMatch, TAG);
	assert.equal(poll.callsTo("/api/queue"), 2);
	assert.equal(poll.callsTo("/api/playlists"), 2);

	await poll.ticks(2);

	assert.equal(
		poll.callsTo("/api/queue"),
		2,
		"a read that landed was repeated",
	);
	assert.equal(
		poll.callsTo("/api/playlists"),
		2,
		"a read that landed was repeated",
	);
});

const { MARK_FOLLOW_UP_MS } = playerPoll as { MARK_FOLLOW_UP_MS?: number };

const TRACK = "Artist/Album/01 One.flac";
const NEXT_TRACK = "Artist/Album/02 Two.flac";
const TRACK_AFTER = "Artist/Album/03 Three.flac";
const HEARD_REVISION = 5;

class SilentAudio {
	preload = "";
	autoplay = false;
	volume = 1;
	muted = false;
	src = "";
	currentTime = 0;
	paused = true;
	error = null;
	buffered = { length: 0, start: () => 0, end: () => 0 };
	addEventListener() {}
	removeEventListener() {}
	removeAttribute() {}
	load() {}
	pause() {}
	play() {
		return Promise.resolve();
	}
}

interface Shown {
	tag: string;
	player: Partial<PlayerSection>;
}

const showing = (tag: string, player: Partial<PlayerSection>): Shown => ({
	tag,
	player: {
		path: TRACK,
		queueRevision: 1,
		playlistsRevision: 1,
		timelineRevision: HEARD_REVISION,
		...player,
	},
});

const listeningHarness = async (t: TestContext) => {
	let shown = showing('"t1"', {});
	const poll = harness(t, (ifNoneMatch, url) => {
		const path = new URL(url).pathname;
		if (path === STATE_PATH)
			return ifNoneMatch === shown.tag
				? unchanged()
				: document200("playing", shown.tag, shown.player);
		if (path === "/api/stream/ticket")
			return Promise.resolve(Response.json({ ticket: "a-ticket" }));
		if (path === "/api/stream/timeline")
			return Promise.resolve(Response.json({ streamTime: 60, marks: [] }));
		if (path === "/api/queue")
			return Promise.resolve(Response.json({ revision: 1, entries: [] }));
		if (path === "/api/playlists")
			return Promise.resolve(Response.json({ playlists: [] }));
		return Promise.resolve(new Response(null, { status: 204 }));
	});
	await poll.settle();
	await poll.ticks(1);

	const realAudio = globalThis.Audio;
	globalThis.Audio = SilentAudio as unknown as typeof Audio;
	configureListening({ origin: ORIGIN, formats: ["opus"], session: null });
	connect();
	poll.atTeardown(() => {
		disconnect();
		configureListening(null);
		globalThis.Audio = realAudio;
	});
	await poll.settle();
	await poll.ticks(1);

	const lookedAtNow = () =>
		poll.stateCalls().filter((call) => call.ifNoneMatch === null);

	return {
		poll,
		show: (next: Shown) => {
			shown = next;
		},
		extraLooksAfterChange: async (whileWaiting?: () => Promise<void>) => {
			const before = lookedAtNow().length;
			const changedAt = Date.now();
			await poll.ticks(1);
			await whileWaiting?.();
			await poll.advance(changedAt + 2 * POLL_MS - STEP_MS - Date.now());
			return lookedAtNow()
				.slice(before)
				.map((call) => call.at - changedAt - POLL_MS);
		},
	};
};

test("while listening, a new track with no new mark yet is looked at once more, a moment later", async (t) => {
	const listening = await listeningHarness(t);

	listening.show(showing('"t2"', { path: NEXT_TRACK }));

	assert.deepEqual(await listening.extraLooksAfterChange(), [
		MARK_FOLLOW_UP_MS,
	]);
});

test("while listening, a seek with no new mark yet is looked at once more, a moment later", async (t) => {
	const listening = await listeningHarness(t);

	listening.show(
		showing('"t2"', { position: { seconds: 150, ageSeconds: 0 } }),
	);

	assert.deepEqual(await listening.extraLooksAfterChange(), [
		MARK_FOLLOW_UP_MS,
	]);
});

test("while listening, a new track whose mark is already announced is not looked at again", async (t) => {
	const listening = await listeningHarness(t);

	listening.show(
		showing('"t2"', {
			path: NEXT_TRACK,
			timelineRevision: HEARD_REVISION + 1,
		}),
	);

	assert.deepEqual(await listening.extraLooksAfterChange(), []);
});

// A locked phone is a hidden tab, and the lock screen's media session is fed
// from this poll.
test("a hidden tab that is listening goes on asking, and sees a track change nobody made here", async (t) => {
	const listening = await listeningHarness(t);
	listening.poll.hide();
	await listening.poll.settle();

	listening.show(showing('"t2"', { path: NEXT_TRACK }));
	await listening.poll.ticks(1);

	assert.equal(playingTrack(playerIn(listening.poll.client))?.path, NEXT_TRACK);
});

test("once this device has stopped listening, a new track is not looked at again", async (t) => {
	// Stopped rather than never started: the timeline it read while listening
	// can outlive the connection, and then only the listening check is left.
	const stopped = await listeningHarness(t);
	disconnect();

	stopped.show(showing('"t2"', { path: NEXT_TRACK }));

	assert.deepEqual(await stopped.extraLooksAfterChange(), []);
});

test("a second change seen while a look is pending adds no second look", async (t) => {
	// A skip's own read of `/state` is the common second sighting: it lands
	// inside the window of the tick that saw the change first.
	const SECOND_SIGHTING_MS = 100;
	const listening = await listeningHarness(t);

	listening.show(showing('"t2"', { path: NEXT_TRACK }));

	const looks = await listening.extraLooksAfterChange(async () => {
		await listening.poll.advance(SECOND_SIGHTING_MS);
		listening.show(showing('"t3"', { path: TRACK_AFTER }));
		await pollPlayerNow(listening.poll.client, ORIGIN);
		await listening.poll.settle();
	});

	assert.deepEqual(looks, [SECOND_SIGHTING_MS, MARK_FOLLOW_UP_MS]);
});

const EVEN_LATER_TAG = '"s1-r4-p9"';

const holdMode = (client: QueryClient, playbackMode: PlaybackMode) =>
	playerPoll.holdPlayerWrite(client, () => ({ playbackMode }));

const modeIn = (client: QueryClient) => playerIn(client)?.playbackMode ?? null;

const answeredLater = () => {
	let answer: (response: Response) => void = () => {};
	const pending = new Promise<Response>((resolve) => {
		answer = resolve;
	});
	return { pending: () => pending, answer };
};

test("a poll asked before a write was answered keeps the write's value and draws everything else", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const write = holdMode(poll.client, "repeatOne");
	const late = answeredLater();
	poll.answersState(late.pending);
	await poll.ticks(1);
	write?.answered();
	late.answer(
		await document200("paused", LATER_TAG, { playbackMode: "inOrder" }),
	);
	await poll.settle();

	assert.equal(modeIn(poll.client), "repeatOne");
	assert.equal(playbackIn(poll.client), "paused");
});

test("a poll asked after a write was answered draws the player's value", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const write = holdMode(poll.client, "repeatOne");
	write?.answered();
	poll.answersState(() =>
		document200("playing", LATER_TAG, { playbackMode: "shuffleTracks" }),
	);
	await poll.ticks(1);

	assert.equal(modeIn(poll.client), "shuffleTracks");
});

test("a write the player answered without taking is drawn back by the next poll, though nothing else moved", async (t) => {
	// The poll that drew over the write carried the player's validator for a state the key did not
	// show, so a `304` to it would leave the write's value standing for good.
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const write = holdMode(poll.client, "repeatOne");
	await poll.ticks(1);
	assert.equal(modeIn(poll.client), "repeatOne");

	write?.answered();
	poll.answersState((ifNoneMatch) =>
		ifNoneMatch === TAG
			? unchanged()
			: document200("playing", TAG, { playbackMode: "inOrder" }),
	);
	await poll.ticks(1);

	assert.equal(modeIn(poll.client), "inOrder");
});

test("a write refused after a newer poll rolls back to what that poll said, not to what was drawn before the press", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const write = holdMode(poll.client, "repeatOne");
	poll.answersState(() =>
		document200("paused", LATER_TAG, { playbackMode: "shuffleTracks" }),
	);
	await poll.ticks(1);
	assert.equal(modeIn(poll.client), "repeatOne");

	write?.rollBack();

	assert.equal(modeIn(poll.client), "shuffleTracks");
	assert.equal(playbackIn(poll.client), "paused");
});

test("a write refused before any poll answered rolls back to what was drawn before the press", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const write = holdMode(poll.client, "repeatOne");
	assert.equal(modeIn(poll.client), "repeatOne");
	write?.rollBack();

	assert.equal(modeIn(poll.client), "inOrder");
});

test("of two writes to one field, the first refused leaves the second's value through a poll", async (t) => {
	const poll = harness(
		t,
		stateOnly(() => document200("playing", TAG, { playbackMode: "inOrder" })),
		CAPABILITIES,
	);
	await poll.settle();

	const first = holdMode(poll.client, "repeatOne");
	holdMode(poll.client, "shuffleTracks");
	poll.answersState(() =>
		document200("playing", EVEN_LATER_TAG, { playbackMode: "inOrder" }),
	);
	await poll.ticks(1);
	first?.rollBack();

	assert.equal(modeIn(poll.client), "shuffleTracks");
});
