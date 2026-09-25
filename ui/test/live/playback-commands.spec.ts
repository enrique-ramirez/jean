import {
	COMPONENT,
	component,
	type PlaybackMode,
	player,
	removePlaylist,
	send,
} from "./component.ts";
import { expect, test } from "./fixtures.ts";

// Every playback command sent to `foo_jean` on a real foobar2000, each read back from
// `GET /api/state` rather than from the command's own answer.
//
// Plays nothing unless the player is already muted. Every level and mute check runs stopped.

const PROBE = "#Jean 017 probe";
const LONG_ENOUGH_S = 120;
const PROBE_ROWS = 3;
const HELD_SKIPS = 20;
const TIMED_WRITES = 20;
const SEEK_TO_S = 30;
const SEEK_BY_S = -10;

const MODES: readonly PlaybackMode[] = [
	"inOrder",
	"repeatAll",
	"repeatOne",
	"random",
	"shuffleTracks",
	"shuffleAlbums",
	"shuffleFolders",
];

const setMode = async (mode: PlaybackMode) => {
	await send("/api/playback/mode", { mode });
	await expect.poll(async () => (await player()).playbackMode).toBe(mode);
};

const sendRaw = (path: string, body?: unknown) =>
	fetch(`${COMPONENT()}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

const listeners = () =>
	component<{
		connections: number;
		devices: unknown[];
		playerMuted: boolean;
	}>("/api/stream/listeners");

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

const ms = (value: number) => `${value.toFixed(1)} ms`;

const requireMuted = async () => {
	if (!(await player()).muted)
		throw new Error("Mute the player first: this test plays real audio.");
};

const requireStopped = async () => {
	await send("/api/playback/stop");
	await expect.poll(async () => (await player()).playback).toBe("stopped");
};

const untilLevel = (value: number, muted: boolean) =>
	expect
		.poll(async () => {
			const now = await player();
			return { value: now.volume, muted: now.muted };
		})
		.toEqual({ value, muted });

// A real listener, held open and drained the way a browser would, so the component counts it
// and its output hold acts on it. The stream answers while the player is stopped.
const listen = async () => {
	const deviceId = crypto.randomUUID();
	const { ticket } = await component<{ ticket: string }>("/api/stream/ticket", {
		method: "POST",
		body: JSON.stringify({ deviceId, name: "Jean live spec" }),
	});
	const stopping = new AbortController();
	const response = await fetch(
		`${COMPONENT()}/api/stream?ticket=${encodeURIComponent(ticket)}`,
		{ signal: stopping.signal },
	);
	expect(response.status).toBe(200);
	const reader = response.body?.getReader();
	const draining = (async () => {
		while (reader && !(await reader.read()).done);
	})().catch(() => undefined);

	// `foo_jean` ignores a leave from a device it still counts a connection for, and then waits
	// out its linger instead, which keeps the listening going into the next test.
	return async () => {
		stopping.abort();
		await draining;
		await expect.poll(async () => (await listeners()).connections).toBe(0);
		await send("/api/stream/leave", { deviceId });
	};
};

test.describe.configure({ mode: "serial" });

let probe = "";
let ownerLevel: number | null = null;
let ownerMode: PlaybackMode | null = null;

test.beforeAll(async ({ install }) => {
	test.setTimeout(120_000);
	const before = await player();
	if (before.playback !== "stopped" || !before.muted)
		throw new Error(
			"Stop and mute the player first: these tests play real audio.",
		);
	ownerMode = before.playbackMode;

	// A stopped player makes no sound, so unmuting it is the one way to read the level the owner
	// muted from.
	await send("/api/volume", { muted: false });
	await expect.poll(async () => (await player()).muted).toBe(false);
	ownerLevel = (await player()).volume;
	await send("/api/volume", { muted: true });
	await expect.poll(async () => (await player()).muted).toBe(true);

	const stale = (
		await component<{ playlists: { id: string; title: string }[] }>(
			"/api/playlists",
		)
	).playlists.filter((entry) => entry.title === PROBE);
	for (const entry of stale) await removePlaylist(entry.id);

	const ordinals = install.tracks
		.map((track, ordinal) => ({ ordinal, seconds: Number(track.seconds) }))
		.filter((track) => track.seconds >= LONG_ENOUGH_S)
		.slice(0, PROBE_ROWS)
		.map((track) => track.ordinal);
	if (ordinals.length < PROBE_ROWS)
		throw new Error(
			`the library holds fewer than ${PROBE_ROWS} tracks of ${LONG_ENOUGH_S} s`,
		);

	const created = await component<{ id: string; itemCount: number }>(
		"/api/playlists",
		{
			method: "POST",
			body: JSON.stringify({
				title: PROBE,
				structure: install.structure,
				ordinals,
			}),
		},
	);
	probe = created.id;
	expect(created.itemCount).toBe(PROBE_ROWS);
});

test.afterAll(async () => {
	await send("/api/playback/stop");
	await expect.poll(async () => (await player()).playback).toBe("stopped");
	if (probe) await removePlaylist(probe);
	if (ownerMode !== null) await setMode(ownerMode);
	if (ownerLevel !== null) await send("/api/volume", { value: ownerLevel });
	await send("/api/volume", { muted: true });
	const after = await player();
	console.log(
		`[017] put back: ${after.playback}, ${after.volume} dB, muted ${after.muted}, playbackMode ${after.playbackMode}`,
	);
});

test("play, play-pause both ways, next, previous, an absolute and a relative seek and stop each land on the player", async () => {
	await requireMuted();
	await setMode("inOrder");
	const at = async () => {
		const { playback, playingLocation } = await player();
		return { playback, playingLocation };
	};
	const playingRow = (index: number) =>
		expect.poll(at, { timeout: 30_000 }).toEqual({
			playback: "playing",
			playingLocation: { playlistId: probe, index },
		});

	await send(`/api/playlists/${probe}/items/0/play`);
	await playingRow(0);

	await send("/api/playback/play-pause");
	await expect.poll(async () => (await player()).playback).toBe("paused");
	await send("/api/playback/play-pause");
	await expect.poll(async () => (await player()).playback).toBe("playing");

	await send("/api/playback/next");
	await playingRow(1);
	await send("/api/playback/previous");
	await playingRow(0);

	await send("/api/playback/play-pause");
	await expect.poll(async () => (await player()).playback).toBe("paused");
	await send("/api/playback/seek", { seconds: SEEK_TO_S });
	await expect
		.poll(async () => Math.round((await player()).position.seconds))
		.toBe(SEEK_TO_S);
	await send("/api/playback/seek", { relativeSeconds: SEEK_BY_S });
	await expect
		.poll(async () => Math.round((await player()).position.seconds))
		.toBe(SEEK_TO_S + SEEK_BY_S);

	await send("/api/playback/stop");
	await expect.poll(async () => (await player()).playback).toBe("stopped");

	// From a stop, whether play-pause starts anything is foobar2000's call, so it is recorded.
	await send("/api/playback/play-pause");
	await expect.poll(async () => (await player()).playback).not.toBe("paused");
	const fromStop = await at();
	console.log(`[017] play-pause from a stop: ${JSON.stringify(fromStop)}`);
	await requireStopped();
});

test("a held skip key is twenty nexts in a row, every one taken with a 204 and none told to retry, and the player still answers after", async () => {
	await requireMuted();
	await setMode("repeatAll");
	await send(`/api/playlists/${probe}/items/0/play`);
	await expect
		.poll(async () => (await player()).playback, { timeout: 30_000 })
		.toBe("playing");

	const answers: { status: number; retryAfter: string | null }[] = [];
	const from = performance.now();
	for (let press = 0; press < HELD_SKIPS; press++) {
		const response = await sendRaw("/api/playback/next");
		await response.text();
		answers.push({
			status: response.status,
			retryAfter: response.headers.get("Retry-After"),
		});
	}
	const took = performance.now() - from;

	expect(answers.map((answer) => answer.status)).toEqual(
		Array(HELD_SKIPS).fill(204),
	);
	expect(answers.filter((answer) => answer.retryAfter !== null)).toEqual([]);
	await expect
		.poll(async () => (await player()).playback, { timeout: 30_000 })
		.toBe("playing");
	const status = await fetch(`${COMPONENT()}/api/status`);
	expect(status.status).toBe(200);
	await status.text();

	console.log(
		`[017] held skip: ${HELD_SKIPS} nexts in ${ms(took)}, landed on row ${(await player()).playingLocation?.index} (${HELD_SKIPS % PROBE_ROWS} if every one counted, from row 0 of ${PROBE_ROWS} on repeat)`,
	);
	await requireStopped();
});

test("each of the seven playback modes set by name reads back as that mode", async () => {
	await setMode(MODES[MODES.length - 1]);

	for (const mode of MODES) {
		await send("/api/playback/mode", { mode });
		await expect
			.poll(async () => (await player()).playbackMode, { message: mode })
			.toBe(mode);
	}
});

test("a level set, a step up, a step down, a mute and an unmute each land on the player, and the unmute brings back the level it muted from", async () => {
	await requireStopped();
	const written = -30;

	await send("/api/volume", { value: written });
	await untilLevel(written, false);

	await send("/api/volume", { step: "up" });
	await expect
		.poll(async () => (await player()).volume)
		.toBeGreaterThan(written);
	const up = (await player()).volume;

	await send("/api/volume", { step: "down" });
	await expect.poll(async () => (await player()).volume).toBeLessThan(up);
	const down = (await player()).volume;

	await send("/api/volume", { muted: true });
	await expect.poll(async () => (await player()).muted).toBe(true);

	await send("/api/volume", { muted: false });
	await untilLevel(down, false);

	console.log(
		`[017] level: set ${written} dB, stepped up to ${up}, down to ${down}, muted, unmuted back to ${(await player()).volume}`,
	);
	await send("/api/volume", { muted: true });
	await expect.poll(async () => (await player()).muted).toBe(true);
});

test("twenty writes to /api/volume in a row each land with a 204 on one kept-alive connection", async () => {
	await requireStopped();
	await requireMuted();

	const writes: number[] = [];
	await (await sendRaw("/api/volume", { muted: true })).text();
	for (let at = 0; at < TIMED_WRITES; at++) {
		const from = performance.now();
		const response = await sendRaw("/api/volume", { muted: true });
		await response.text();
		writes.push(performance.now() - from);
		expect(response.status).toBe(204);
	}

	console.log(
		`[017] POST /api/volume, ${TIMED_WRITES} writes on one kept-alive connection: median ${ms(median(writes))}, max ${ms(Math.max(...writes))}`,
	);
});

test("with a listener attached, a level written through the component lands, the hold lets go of the player, and the level stays when the listener leaves", async () => {
	test.skip(ownerLevel === null, "the owner's level was never read");
	const level = ownerLevel as number;
	const written = level > -50 ? level - 10 : level + 10;
	await requireStopped();
	expect((await listeners()).connections).toBe(0);

	await send("/api/volume", { value: level });
	await untilLevel(level, false);

	const leave = await listen();
	try {
		await expect.poll(async () => (await player()).muted).toBe(true);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(true);

		await send("/api/volume", { value: written });
		await untilLevel(written, false);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(false);
	} finally {
		await leave();
	}

	await untilLevel(written, false);
	console.log(
		`[017] hold: listener muted the player from ${level} dB, write of ${written} landed and cleared playerMuted, after leaving ${(await player()).volume} dB muted ${(await player()).muted}`,
	);
	await send("/api/volume", { value: level });
	await untilLevel(level, false);
});

test("with a listener attached, a hand mute after a level write is undone to the level from before the listening once the listener leaves", async () => {
	test.skip(ownerLevel === null, "the owner's level was never read");
	const level = ownerLevel as number;
	const written = level > -50 ? level - 10 : level + 10;
	await requireStopped();
	await send("/api/volume", { value: level });
	await untilLevel(level, false);

	const leave = await listen();
	try {
		await expect.poll(async () => (await listeners()).playerMuted).toBe(true);
		await send("/api/volume", { value: written });
		await untilLevel(written, false);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(false);

		await send("/api/volume", { muted: true });
		await expect.poll(async () => (await player()).muted).toBe(true);
		expect((await listeners()).playerMuted).toBe(false);
	} finally {
		await leave();
	}

	// A hold that had not seen the write would still count itself holding, and give the player
	// back through foobar2000's mute toggle, which restores the written level instead.
	await untilLevel(level, false);
	console.log(
		`[017] hold: hand mute at ${written} dB mid-listen came back as ${(await player()).volume} dB after leaving`,
	);
});
