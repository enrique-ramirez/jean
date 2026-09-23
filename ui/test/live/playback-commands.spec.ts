import { COMPONENT, component, removePlaylist, TOKEN } from "./component.ts";
import { api, expect, post, test } from "./fixtures.ts";

// Every playback command sent to `foo_jean` on a real foobar2000, and read back off beefweb,
// which reports the same player as a third party, so the expected value is never the component's
// own answer. Beefweb also sets up and puts back what the commands move, for the same reason.
//
// Plays nothing unless the player is already muted. Every level and mute check runs stopped.

const PROBE = "#Jean 017 probe";
const LONG_ENOUGH_S = 120;
const PROBE_ROWS = 3;
const HELD_SKIPS = 20;
const TIMED_WRITES = 20;
const TIMED_PREFLIGHTS = 5;
const SEEK_TO_S = 30;
const SEEK_BY_S = -10;

// foobar2000's own names for its playback orders, which beefweb lists in the order this install
// numbers them. The component keeps its own copy of this table; this one is the reader's.
const FOOBAR_ORDER = {
	inOrder: "Default",
	repeatAll: "Repeat (playlist)",
	repeatOne: "Repeat (track)",
	random: "Random",
	shuffleTracks: "Shuffle (tracks)",
	shuffleAlbums: "Shuffle (albums)",
	shuffleFolders: "Shuffle (folders)",
} as const;
type Mode = keyof typeof FOOBAR_ORDER;
const MODES = Object.keys(FOOBAR_ORDER) as Mode[];

const origin = () => {
	const live = process.env.LIVE;
	if (!live) throw new Error("LIVE must name the url the app is served at.");
	return new URL(live).origin;
};

interface BeefwebPlayer {
	playbackState: "playing" | "paused" | "stopped";
	playbackMode: number;
	playbackModes: string[];
	activeItem: { playlistId: string; index: number; position: number };
	volume: { value: number; isMuted: boolean; min: number; max: number };
}

const beefweb = () =>
	api<{ player: BeefwebPlayer }>(origin(), "/player").then(
		(answer) => answer.player,
	);

const setOrderAtBeefweb = async (name: string) => {
	const { playbackModes } = await beefweb();
	await post(origin(), "/player", {
		options: [{ id: "playbackOrder", value: playbackModes.indexOf(name) }],
	});
	await expect
		.poll(async () => (await beefweb()).playbackMode)
		.toBe(playbackModes.indexOf(name));
};

const command = (path: string, body?: unknown) =>
	component<void>(path, {
		method: "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

const sendRaw = (path: string, body?: unknown) =>
	fetch(`${COMPONENT()}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${TOKEN()}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
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
	if (!(await beefweb()).volume.isMuted)
		throw new Error("Mute the player first: this test plays real audio.");
};

const requireStopped = async () => {
	await command("/api/playback/stop");
	await expect
		.poll(async () => (await beefweb()).playbackState)
		.toBe("stopped");
};

const untilLevel = (value: number, isMuted: boolean) =>
	expect
		.poll(async () => {
			const { volume } = await beefweb();
			return { value: volume.value, isMuted: volume.isMuted };
		})
		.toEqual({ value, isMuted });

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
		await command("/api/stream/leave", { deviceId });
	};
};

test.describe.configure({ mode: "serial" });

let probe = "";
let probeAtBeefweb = "";
let ownerLevel: number | null = null;
let ownerOrder: number | null = null;

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const player = await beefweb();
	if (player.playbackState !== "stopped" || !player.volume.isMuted)
		throw new Error(
			"Stop and mute the player first: these tests play real audio.",
		);
	ownerOrder = player.playbackMode;

	// A stopped player makes no sound, so unmuting it is the one way to read the level the owner
	// muted from.
	await post(origin(), "/player", { isMuted: false });
	await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(false);
	ownerLevel = (await beefweb()).volume.value;
	await post(origin(), "/player", { isMuted: true });
	await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(true);

	const stale = (
		await component<{ playlists: { id: string; title: string }[] }>(
			"/api/playlists",
		)
	).playlists.filter((entry) => entry.title === PROBE);
	for (const entry of stale) await removePlaylist(entry.id);

	const { libraryItems } = await api<{
		libraryItems: { items: { columns: string[] }[] };
	}>(
		origin(),
		`/library/items?columns=${encodeURIComponent("%path%,%length_seconds%")}`,
	);
	const long = libraryItems.items
		.filter(({ columns: [, seconds] }) => Number(seconds) >= LONG_ENOUGH_S)
		.slice(0, PROBE_ROWS)
		.map(({ columns: [path] }) => path);
	if (long.length < PROBE_ROWS)
		throw new Error(
			`the library holds fewer than ${PROBE_ROWS} tracks of ${LONG_ENOUGH_S} s`,
		);

	probe = (
		await component<{ id: string }>("/api/playlists", {
			method: "POST",
			body: JSON.stringify({ title: PROBE }),
		})
	).id;
	// The component adds library rows by ordinal only, so the paths go in through beefweb.
	// Deleting through beefweb is not safe, which is why the probe goes out through the component.
	const { playlists } = await api<{
		playlists: { id: string; title: string; itemCount: number }[];
	}>(origin(), "/playlists");
	const found = playlists.find((entry) => entry.title === PROBE);
	if (!found) throw new Error(`beefweb does not list ${PROBE}`);
	probeAtBeefweb = found.id;
	await post(origin(), `/playlists/${probeAtBeefweb}/items/add`, {
		items: long,
	});
	await expect
		.poll(async () => {
			const { playlists: now } = await api<{
				playlists: { id: string; itemCount: number }[];
			}>(origin(), "/playlists");
			return now.find((entry) => entry.id === probeAtBeefweb)?.itemCount;
		})
		.toBe(PROBE_ROWS);
});

test.afterAll(async () => {
	await post(origin(), "/player/stop");
	await expect
		.poll(async () => (await beefweb()).playbackState)
		.toBe("stopped");
	if (probe) await removePlaylist(probe);
	if (ownerOrder !== null)
		await post(origin(), "/player", {
			options: [{ id: "playbackOrder", value: ownerOrder }],
		});
	if (ownerLevel !== null)
		await post(origin(), "/player", { volume: ownerLevel });
	const after = await beefweb();
	console.log(
		`[017] put back: ${after.playbackState}, ${after.volume.value} dB, muted ${after.volume.isMuted}, playbackMode ${after.playbackMode} (${after.playbackModes[after.playbackMode]})`,
	);
});

test("play, play-pause both ways, next, previous, an absolute and a relative seek and stop each land on the player", async () => {
	await requireMuted();
	await setOrderAtBeefweb(FOOBAR_ORDER.inOrder);
	const at = async () => {
		const { playbackState, activeItem } = await beefweb();
		return {
			playbackState,
			playlistId: activeItem.playlistId,
			index: activeItem.index,
		};
	};
	const playingRow = (index: number) =>
		expect
			.poll(at, { timeout: 30_000 })
			.toEqual({ playbackState: "playing", playlistId: probeAtBeefweb, index });

	await command(`/api/playlists/${probe}/items/0/play`);
	await playingRow(0);

	await command("/api/playback/play-pause");
	await expect.poll(async () => (await beefweb()).playbackState).toBe("paused");
	await command("/api/playback/play-pause");
	await expect
		.poll(async () => (await beefweb()).playbackState)
		.toBe("playing");

	await command("/api/playback/next");
	await playingRow(1);
	await command("/api/playback/previous");
	await playingRow(0);

	await command("/api/playback/play-pause");
	await expect.poll(async () => (await beefweb()).playbackState).toBe("paused");
	await command("/api/playback/seek", { seconds: SEEK_TO_S });
	await expect
		.poll(async () => Math.round((await beefweb()).activeItem.position))
		.toBe(SEEK_TO_S);
	await command("/api/playback/seek", { relativeSeconds: SEEK_BY_S });
	await expect
		.poll(async () => Math.round((await beefweb()).activeItem.position))
		.toBe(SEEK_TO_S + SEEK_BY_S);

	await command("/api/playback/stop");
	await expect
		.poll(async () => (await beefweb()).playbackState)
		.toBe("stopped");

	// From a stop, whether play-pause starts anything is foobar2000's call, so it is recorded.
	await command("/api/playback/play-pause");
	await expect
		.poll(async () => (await beefweb()).playbackState)
		.not.toBe("paused");
	const fromStop = await at();
	console.log(`[017] play-pause from a stop: ${JSON.stringify(fromStop)}`);
	await requireStopped();
});

test("a held skip key is twenty nexts in a row, every one taken with a 204 and none told to retry, and the player still answers after", async () => {
	await requireMuted();
	await setOrderAtBeefweb(FOOBAR_ORDER.repeatAll);
	await command(`/api/playlists/${probe}/items/0/play`);
	await expect
		.poll(async () => (await beefweb()).playbackState, { timeout: 30_000 })
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
		.poll(async () => (await beefweb()).playbackState, { timeout: 30_000 })
		.toBe("playing");
	const status = await fetch(`${COMPONENT()}/api/status`);
	expect(status.status).toBe(200);
	await status.text();

	console.log(
		`[017] held skip: ${HELD_SKIPS} nexts in ${ms(took)}, landed on row ${(await beefweb()).activeItem.index} (${HELD_SKIPS % PROBE_ROWS} if every one counted, from row 0 of ${PROBE_ROWS} on repeat)`,
	);
	await requireStopped();
});

test("each of the seven playback modes set by name lands on the ordinal beefweb gives that order", async () => {
	const { playbackModes } = await beefweb();
	await setOrderAtBeefweb(FOOBAR_ORDER[MODES[MODES.length - 1]]);

	for (const mode of MODES) {
		await command("/api/playback/mode", { mode });
		await expect
			.poll(async () => (await beefweb()).playbackMode, { message: mode })
			.toBe(playbackModes.indexOf(FOOBAR_ORDER[mode]));
		console.log(
			`[017] mode ${mode}: beefweb reads ${(await beefweb()).playbackMode} (${FOOBAR_ORDER[mode]})`,
		);
	}
});

test("a level set, a step up, a step down, a mute and an unmute each land on the player, and the unmute brings back the level it muted from", async () => {
	await requireStopped();
	const written = -30;

	await command("/api/volume", { value: written });
	await untilLevel(written, false);

	await command("/api/volume", { step: "up" });
	await expect
		.poll(async () => (await beefweb()).volume.value)
		.toBeGreaterThan(written);
	const up = (await beefweb()).volume.value;

	await command("/api/volume", { step: "down" });
	await expect
		.poll(async () => (await beefweb()).volume.value)
		.toBeLessThan(up);
	const down = (await beefweb()).volume.value;

	await command("/api/volume", { muted: true });
	await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(true);

	await command("/api/volume", { muted: false });
	await untilLevel(down, false);

	console.log(
		`[017] level: set ${written} dB, stepped up to ${up}, down to ${down}, muted, unmuted back to ${(await beefweb()).volume.value}`,
	);
	await command("/api/volume", { muted: true });
	await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(true);
});

test("one command's round trip, with its preflight timed apart", async () => {
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

	const preflights: number[] = [];
	for (let at = 0; at < TIMED_PREFLIGHTS; at++) {
		const from = performance.now();
		const response = await fetch(`${COMPONENT()}/api/volume`, {
			method: "OPTIONS",
			headers: {
				Origin: origin(),
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "authorization, content-type",
			},
		});
		await response.text();
		preflights.push(performance.now() - from);
		expect(response.ok).toBe(true);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin());
	}

	console.log(
		`[017] POST /api/volume, ${TIMED_WRITES} writes on one kept-alive connection: median ${ms(median(writes))}, max ${ms(Math.max(...writes))}; OPTIONS preflight, ${TIMED_PREFLIGHTS}: median ${ms(median(preflights))}, first ${ms(preflights[0])}`,
	);
});

test("with a listener attached, a level written through the component lands, the hold lets go of the player, and the level stays when the listener leaves", async () => {
	test.skip(ownerLevel === null, "the owner's level was never read");
	const level = ownerLevel as number;
	const written = level > -50 ? level - 10 : level + 10;
	await requireStopped();
	expect((await listeners()).connections).toBe(0);

	await command("/api/volume", { value: level });
	await untilLevel(level, false);

	const leave = await listen();
	try {
		await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(true);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(true);

		await command("/api/volume", { value: written });
		await untilLevel(written, false);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(false);
	} finally {
		await leave();
	}

	await untilLevel(written, false);
	console.log(
		`[017] hold: listener muted the player from ${level} dB, write of ${written} landed and cleared playerMuted, after leaving ${(await beefweb()).volume.value} dB muted ${(await beefweb()).volume.isMuted}`,
	);
	await command("/api/volume", { value: level });
	await untilLevel(level, false);
});

test("with a listener attached, a hand mute after a level write is undone to the level from before the listening once the listener leaves", async () => {
	test.skip(ownerLevel === null, "the owner's level was never read");
	const level = ownerLevel as number;
	const written = level > -50 ? level - 10 : level + 10;
	await requireStopped();
	await command("/api/volume", { value: level });
	await untilLevel(level, false);

	const leave = await listen();
	try {
		await expect.poll(async () => (await listeners()).playerMuted).toBe(true);
		await command("/api/volume", { value: written });
		await untilLevel(written, false);
		await expect.poll(async () => (await listeners()).playerMuted).toBe(false);

		await command("/api/volume", { muted: true });
		await expect.poll(async () => (await beefweb()).volume.isMuted).toBe(true);
		expect((await listeners()).playerMuted).toBe(false);
	} finally {
		await leave();
	}

	// A hold that had not seen the write would still count itself holding, and give the player
	// back through foobar2000's mute toggle, which restores the written level instead.
	await untilLevel(level, false);
	console.log(
		`[017] hold: hand mute at ${written} dB mid-listen came back as ${(await beefweb()).volume.value} dB after leaving`,
	);
});
