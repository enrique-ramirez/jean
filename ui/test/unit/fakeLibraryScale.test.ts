import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { decodeJlib, type JlibSnapshot } from "../../src/shared/api/jlib.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createState, type Track } from "../fake-api/state.ts";
import { evaluate } from "../fake-api/titleFormat.ts";

type FakeState = ReturnType<typeof createState>;

const MAIN = join(
	dirname(fileURLToPath(import.meta.url)),
	"../fake-api/main.ts",
);

const MILLION = 1_000_000;
const SERVED_AGAIN_MS = 50;
const BUILT_ONCE_TIMEOUT_MS = 10 * 60_000;

const PLAY_COUNT = "%lastfm_play_count%";
const GZIP = { "accept-encoding": "gzip" };
const IDENTITY = {};

interface Answer {
	status: number;
	headers: Record<string, string>;
	body: Uint8Array<ArrayBuffer>;
	ms: number;
}

// The host seam `ui/test/README.md` names: the same route tables answer a node socket and the
// demo's service worker. Driven here with no socket, so a time is the fake's work and not a
// loopback copy of tens of megabytes.
const ask = async (
	state: FakeState,
	path: string,
	{
		query = [],
		headers = {},
	}: { query?: [string, string][]; headers?: Record<string, string> } = {},
): Promise<Answer> => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query) url.searchParams.append(name, value);

	let status = 0;
	let ended = false;
	const answered: Record<string, string> = {};
	const chunks: Uint8Array[] = [];
	const write = (chunk: string | Uint8Array) => {
		chunks.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	};
	const response: Responder = {
		writeHead(code, more = {}) {
			status = code;
			for (const [name, value] of Object.entries(more))
				answered[name.toLowerCase()] = value;
		},
		setHeader(name, value) {
			answered[name.toLowerCase()] = value;
		},
		write,
		end(chunk) {
			if (chunk !== undefined) write(chunk);
			ended = true;
		},
		on() {},
		destroy() {},
	};

	const started = performance.now();
	await handleFooJean({
		state,
		method: "GET",
		url,
		headers,
		body: null,
		response,
		artwork: () => false,
	});
	const ms = performance.now() - started;

	assert.ok(ended, `${path} never finished its answer`);
	const body = new Uint8Array(
		chunks.reduce((total, chunk) => total + chunk.length, 0),
	);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.length;
	}
	return { status, headers: answered, body, ms };
};

const exportOf = (
	state: FakeState,
	columns: readonly string[],
	headers: Record<string, string>,
) =>
	ask(state, "/api/library/export", {
		query: columns.map((column) => ["columns", column]),
		headers,
	});

const changesOf = (
	state: FakeState,
	since: number,
	headers: Record<string, string>,
) =>
	ask(state, "/api/library/changes", {
		query: [["since", String(since)]],
		headers,
	});

// Compared without assert.deepEqual, whose diff of two arrays this size outgrows the heap.
const sameBytes = (one: Uint8Array, other: Uint8Array) =>
	Buffer.compare(one, other) === 0;

const plainOf = async (answer: Answer) => {
	if (answer.headers["content-encoding"] !== "gzip") return answer.body;
	const unzipped = new Response(answer.body).body?.pipeThrough(
		new DecompressionStream("gzip"),
	);
	return new Uint8Array(await new Response(unzipped).arrayBuffer());
};

const decoded = async (answer: Answer) => {
	const plain = await plainOf(answer);
	return decodeJlib(
		plain.buffer.slice(
			plain.byteOffset,
			plain.byteOffset + plain.byteLength,
		) as ArrayBuffer,
	);
};

const snapshotOf = async (answer: Answer): Promise<JlibSnapshot> => {
	const library = await decoded(answer);
	assert.equal(library.kind, "snapshot");
	if (library.kind !== "snapshot") throw new Error("not a snapshot");
	return library;
};

const trackCountOf = async (state: FakeState) => {
	const answer = await ask(state, "/api/state");
	assert.equal(answer.status, 200);
	return JSON.parse(new TextDecoder().decode(answer.body)).library
		.trackCount as number;
};

const libraryPathAt = (library: JlibSnapshot, ordinal: number) =>
	`${library.spine.directory.at(ordinal)}${library.spine.filename.at(ordinal)}`;

const relativePathOf = (track: Track) =>
	String(evaluate(track, "%path%")).replaceAll("\\", "/");

// The fake keeps the whole `%path%`; the snapshot carries it relative to the library's root.
const ordinalOf = (library: JlibSnapshot, track: Track) => {
	const whole = relativePathOf(track);
	for (let ordinal = 0; ordinal < library.trackCount; ordinal += 1)
		if (whole.endsWith(`/${libraryPathAt(library, ordinal)}`)) return ordinal;
	assert.fail(`the export holds no ${whole}`);
};

const playCountAfter = async (
	delta: Answer,
	held: JlibSnapshot,
): Promise<Map<number, string>> => {
	const library = await decoded(delta);
	assert.equal(library.kind, "delta");
	if (library.kind !== "delta") throw new Error("not a delta");
	const patch = library.columns.get(PLAY_COUNT);
	assert.ok(patch, "the delta carries no play count");
	const dict = held.columns.get(PLAY_COUNT)?.dict;
	assert.ok(dict);
	return new Map(
		[...patch.ordinals].map((ordinal, at) => {
			const id = patch.ids[at];
			return [
				ordinal,
				id < patch.base ? dict.of(id) : patch.appended[id - patch.base],
			];
		}),
	);
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
		const exported = await fetch(
			`${origin}/api/library/export?columns=${encodeURIComponent("%title%")}`,
		);
		assert.equal(exported.status, 200);
		await exported.arrayBuffer();

		const polled = await fetch(`${origin}/api/state`);
		assert.equal((await polled.json()).library.trackCount, TRACKS);
	} finally {
		fake.kill();
	}
});

// Criterion 1 at the stretch size. The one build is paid in this test's setup and nowhere else;
// every timed case after it is the fake answering from what it already holds.
test("a library of a million tracks is sorted and encoded once, and answered again at no cost", {
	timeout: BUILT_ONCE_TIMEOUT_MS,
}, async (t) => {
	// Over the component's ceiling with all 21 columns, so the ceiling is lifted as the
	// profiler lifts it.
	const state = createState({
		fooJean: { libraryCeiling: null },
		countsPlays: true,
		mediaLibrary: libraryOfShape({
			tracks: MILLION,
			albums: MILLION / 10,
			artists: MILLION / 100,
			genres: 40,
			years: [1960, 2024],
		}),
	});

	const plain = await exportOf(state, TRACK_EXPRESSIONS, IDENTITY);
	assert.equal(plain.status, 200);
	const zipped = await exportOf(state, TRACK_EXPRESSIONS, GZIP);
	assert.equal(zipped.status, 200);
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.equal(await trackCountOf(state), MILLION);

	await t.test(
		"a second plain export answers the same bytes in under 50 ms",
		async () => {
			const again = await exportOf(state, TRACK_EXPRESSIONS, IDENTITY);
			assert.equal(again.status, 200);
			assert.ok(again.ms < SERVED_AGAIN_MS, `took ${again.ms.toFixed(0)} ms`);
			assert.ok(
				sameBytes(again.body, plain.body),
				"the bytes differ from the first export",
			);
		},
	);

	await t.test(
		"a second gzipped export answers the same bytes in under 50 ms",
		async () => {
			const again = await exportOf(state, TRACK_EXPRESSIONS, GZIP);
			assert.equal(again.status, 200);
			assert.equal(again.headers["content-encoding"], "gzip");
			assert.ok(again.ms < SERVED_AGAIN_MS, `took ${again.ms.toFixed(0)} ms`);
			assert.ok(
				sameBytes(again.body, zipped.body),
				"the bytes differ from the first export",
			);
		},
	);

	await t.test(
		"an export conditional on the held ETag answers 304 in under 50 ms",
		async () => {
			const etag = zipped.headers.etag;
			assert.ok(etag, "the export carried no ETag");
			const again = await exportOf(state, TRACK_EXPRESSIONS, {
				...GZIP,
				"if-none-match": etag,
			});
			assert.equal(again.status, 304);
			assert.equal(again.body.length, 0);
			assert.ok(again.ms < SERVED_AGAIN_MS, `took ${again.ms.toFixed(0)} ms`);
		},
	);

	// Last, since a play moves the revision every case above relies on. The track played
	// is the last one generated, so a search that stops at the first match still walks
	// the whole library to reach it. `plan.md` *Risks* has the delta cached with the export.
	await t.test(
		"a play is counted, and its delta answered, each in under 50 ms",
		async () => {
			const held = await snapshotOf(plain);
			const played = state.libraryTracks[MILLION - 1];

			const started = performance.now();
			state.countPlay(played);
			const counting = performance.now() - started;
			assert.ok(
				counting < SERVED_AGAIN_MS,
				`counting took ${counting.toFixed(0)} ms`,
			);

			const delta = await changesOf(state, held.revision, IDENTITY);
			assert.equal(delta.status, 200);
			assert.ok(
				delta.ms < SERVED_AGAIN_MS,
				`the delta took ${delta.ms.toFixed(0)} ms`,
			);
			assert.equal((await playCountAfter(delta, held)).size, 1);
		},
	);
});

const SMALL = () =>
	createState({
		fooJean: {},
		countsPlays: true,
		mediaLibrary: libraryOfShape({ tracks: 60, albums: 7, artists: 3 }),
	});

const COUNTED = ["%title%", PLAY_COUNT];

// `libraryOfShape` deals tracks out to albums round-robin, so the order they were generated in
// is not the order the export numbers them in: a play counted at the generated index lands on
// another track.
test("a play is counted against the track that was played, at its export ordinal", async () => {
	const state = SMALL();
	const held = await snapshotOf(await exportOf(state, COUNTED, IDENTITY));
	const played = state.libraryTracks[8];
	const ordinal = ordinalOf(held, played);
	assert.notEqual(
		ordinal,
		8,
		"the fixture no longer tells the two orders apart",
	);
	const before = Number(held.columns.get(PLAY_COUNT)?.at(ordinal));

	state.countPlay(played);
	const delta = await changesOf(state, held.revision, IDENTITY);
	assert.equal(delta.status, 200);

	assert.deepEqual(
		await playCountAfter(delta, held),
		new Map([[ordinal, String(before + 1)]]),
	);
});

test("an export after a play carries the new count, and the ETag held before it no longer answers 304", async () => {
	const state = SMALL();
	const first = await exportOf(state, COUNTED, GZIP);
	const held = await snapshotOf(first);
	const played = state.libraryTracks[8];
	const ordinal = ordinalOf(held, played);
	const before = Number(held.columns.get(PLAY_COUNT)?.at(ordinal));

	state.countPlay(played);
	const after = await exportOf(state, COUNTED, {
		...GZIP,
		"if-none-match": first.headers.etag,
	});

	assert.equal(after.status, 200);
	const fresh = await snapshotOf(after);
	assert.equal(fresh.revision, held.revision + 1);
	assert.equal(fresh.columns.get(PLAY_COUNT)?.at(ordinal), String(before + 1));
});
