import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createState, type Track } from "../fake-api/state.ts";
import { evaluate } from "../fake-api/titleFormat.ts";
import {
	ask,
	type FakeState,
	libraryOf,
	type RowsBody,
	rawOf,
	readRows,
} from "./fakeLibraryHarness.ts";

const MAIN = join(
	dirname(fileURLToPath(import.meta.url)),
	"../fake-api/main.ts",
);

const MILLION = 1_000_000;
const SERVED_AGAIN_MS = 50;
const BUILT_ONCE_TIMEOUT_MS = 10 * 60_000;
const WINDOW_ROWS = 100;

const PLAY_COUNT = "%lastfm_play_count%";
const COUNTED = ["%title%", PLAY_COUNT];

const rowsAsked = (
	state: FakeState,
	columns: readonly string[],
	ordinals: number[],
	structure: string,
) =>
	ask(state, "/api/library/rows", {
		method: "POST",
		body: { columns, structure, ordinals },
	});

const declaredThroughRows = async (
	state: FakeState,
	columns: readonly string[],
) => {
	assert.equal((await rowsAsked(state, columns, [0], "0")).status, 202);
	const library = await libraryOf(state);
	assert.equal(library.ready, true, "the declaration was not built");
	return String(library.structure);
};

const windowOf = async (
	state: FakeState,
	columns: readonly string[],
	ordinals: number[],
	structure: string,
) => {
	const started = performance.now();
	const answer = await rowsAsked(state, columns, ordinals, structure);
	const ms = performance.now() - started;
	assert.equal(answer.status, 200);
	return { rows: readRows(rawOf(answer)), ms };
};

const relativePathOf = (track: Track) =>
	String(evaluate(track, "%path%")).replaceAll("\\", "/");

const ordinalIn = (rows: RowsBody, track: Track) => {
	const whole = relativePathOf(track);
	const { directory, filename } = rows.spine;
	const at = directory.cells.findIndex((held, row) =>
		whole.endsWith(`/${held}${filename.cells[row]}`),
	);
	assert.notEqual(at, -1, `the library holds no ${whole}`);
	return at;
};

const pickFreePort = async () => {
	const probe = createNetServer();
	probe.listen(0, "127.0.0.1");
	await once(probe, "listening");
	const address = probe.address();
	assert.ok(address && typeof address === "object");
	probe.close();
	await once(probe, "close");
	return address.port;
};

test("`pnpm fake --tracks <n>` serves a library of that many tracks", async () => {
	const TRACKS = 1234;
	const port = await pickFreePort();
	const fake = spawn(
		process.execPath,
		[MAIN, "--tracks", String(TRACKS), "--port", String(port)],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	try {
		await new Promise<void>((resolve, reject) => {
			fake.stdout.on("data", (chunk: Buffer) => {
				if (chunk.toString().includes(`:${port}`)) resolve();
			});
			fake.on("exit", (code) =>
				reject(new Error(`the fake exited with ${code} before it listened`)),
			);
		});

		const origin = `http://127.0.0.1:${port}`;
		const declared = await fetch(`${origin}/api/library/rows`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				columns: ["%title%"],
				structure: "0",
				ordinals: [0],
			}),
		});
		assert.equal(declared.status, 202);
		await declared.arrayBuffer();

		const polled = await fetch(`${origin}/api/state`);
		assert.equal((await polled.json()).library.trackCount, TRACKS);
	} finally {
		fake.kill();
	}
});

test("a library of a million tracks is sorted once, a second window answers in under 50 ms, and a play reaches the next window", {
	timeout: BUILT_ONCE_TIMEOUT_MS,
}, async (t) => {
	const state = createState({
		countsPlays: true,
		mediaLibrary: libraryOfShape({
			tracks: MILLION,
			albums: MILLION / 10,
			artists: MILLION / 100,
			genres: 40,
			years: [1960, 2024],
		}),
	});
	const declared = [...TRACK_EXPRESSIONS];
	assert.ok(
		declared.includes(PLAY_COUNT),
		"Jean no longer declares the play count",
	);
	const structure = await declaredThroughRows(state, declared);
	assert.equal((await libraryOf(state)).trackCount, MILLION);

	const last = Array.from(
		{ length: WINDOW_ROWS },
		(_, at) => MILLION - WINDOW_ROWS + at,
	);
	const first = await windowOf(state, declared, last, structure);

	await t.test(
		"a second window answers the same rows in under 50 ms",
		async () => {
			const again = await windowOf(state, declared, last, structure);
			assert.ok(again.ms < SERVED_AGAIN_MS, `took ${again.ms.toFixed(0)} ms`);
			assert.deepEqual(
				again.rows.columns.get("%title%")?.cells,
				first.rows.columns.get("%title%")?.cells,
			);
		},
	);

	await t.test(
		"the first window after a play carries the new count",
		async () => {
			const played = state.libraryTracks[MILLION - 1];
			const at = ordinalIn(first.rows, played);
			const before = Number(first.rows.columns.get(PLAY_COUNT)?.cells[at]);

			state.countPlay(played);
			// Unbounded in time: the fake sweeps the whole library once per revision.
			const after = await windowOf(state, declared, last, structure);
			assert.equal(
				after.rows.columns.get(PLAY_COUNT)?.cells[at],
				String(before + 1),
			);
		},
	);
});

const SMALL = () =>
	createState({
		countsPlays: true,
		mediaLibrary: libraryOfShape({ tracks: 60, albums: 7, artists: 3 }),
	});

test("a play is counted against the track that was played, at its ordinal, and the next window carries it at the next revision", async () => {
	const state = SMALL();
	const structure = await declaredThroughRows(state, COUNTED);
	const every = Array.from({ length: 60 }, (_, at) => at);
	const held = (await windowOf(state, COUNTED, every, structure)).rows;
	const played = state.libraryTracks[8];
	const ordinal = ordinalIn(held, played);
	assert.notEqual(
		ordinal,
		8,
		"the fixture no longer tells the two orders apart",
	);
	const before = Number(held.columns.get(PLAY_COUNT)?.cells[ordinal]);

	state.countPlay(played);
	const after = (await windowOf(state, COUNTED, [ordinal], structure)).rows;

	assert.equal(
		BigInt(after.header.revision),
		BigInt(held.header.revision) + 1n,
	);
	assert.deepEqual(after.columns.get(PLAY_COUNT)?.cells, [String(before + 1)]);
	assert.deepEqual(
		held.columns.get(PLAY_COUNT)?.cells.filter((_, at) => at !== ordinal),
		(await windowOf(state, COUNTED, every, structure)).rows.columns
			.get(PLAY_COUNT)
			?.cells.filter((_, at) => at !== ordinal),
	);
});
