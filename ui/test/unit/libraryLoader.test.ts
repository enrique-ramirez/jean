import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { mock, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import * as store from "../../src/domain/track/libraryLoader.ts";
import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import {
	type PlaylistSnapshot,
	playlistSnapshot,
	subscribePlaylist,
} from "../../src/domain/track/playlistEntries.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import { en } from "../../src/shared/i18n/en.ts";

// The component library entry is one per origin and outlives a test, so each
// test reads the library from an origin of its own.
let origins = 0;
const libraryOrigin = () => {
	origins += 1;
	return `http://library-${origins}.invalid:8881`;
};

const SNAPSHOT = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "fixtures/library.jlib"),
);

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

type Build = NonNullable<StateDocument["library"]["build"]>;

type Export =
	| { kind: "snapshot" }
	| { kind: "held"; until: Promise<void> }
	| { kind: "building" }
	| { kind: "unreachable" }
	| { kind: "refused"; status: number; body?: unknown };

const SNAPSHOT_EXPORT: Export = { kind: "snapshot" };
const BUILDING: Export = { kind: "building" };
const UNREACHABLE: Export = { kind: "unreachable" };
const refusedWith = (status: number, body?: unknown): Export => ({
	kind: "refused",
	status,
	body,
});
const SERVER_ERROR = refusedWith(500);

interface LibraryPlayer {
	exports: Export[];
	exportsAsked: number;
	build: Build | null;
	structure: number;
	stateFailures: number;
}

const answerExport = (answer: Export) => {
	switch (answer.kind) {
		case "snapshot":
			return Promise.resolve(new Response(SNAPSHOT));
		case "held":
			return answer.until.then(() => new Response(SNAPSHOT));
		case "building":
			return Promise.resolve(new Response(null, { status: 202 }));
		case "unreachable":
			return Promise.reject(new TypeError("fetch failed"));
		case "refused":
			return Promise.resolve(
				answer.body === undefined
					? new Response(null, { status: answer.status })
					: Response.json(answer.body, { status: answer.status }),
			);
	}
};

const libraryPlayer = (t: TestContext, exports: Export[]): LibraryPlayer => {
	const player: LibraryPlayer = {
		exports,
		exportsAsked: 0,
		build: null,
		structure: 0,
		stateFailures: 0,
	};

	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => {
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	globalThis.fetch = ((request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/api/library/export") {
			const at = Math.min(player.exportsAsked, player.exports.length - 1);
			player.exportsAsked += 1;
			return answerExport(player.exports[at]);
		}
		if (pathname === "/api/state" && player.stateFailures > 0) {
			player.stateFailures -= 1;
			return Promise.reject(new TypeError("fetch failed"));
		}
		if (pathname === "/api/state")
			return Promise.resolve(
				Response.json({
					library: {
						ready: false,
						structure: player.structure,
						revision: 0,
						trackCount: 0,
						columns: [],
						build: player.build,
					},
				}),
			);
		return Promise.reject(new Error(`unexpected request: ${pathname}`));
	}) as typeof fetch;

	return player;
};

// A failed export resolves over microtask turns and never over a timer.
const SETTLE_STEPS = 20;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async () => {
	for (let step = 0; step < SETTLE_STEPS; step += 1) await flush();
};

const readLibrary = async (t: TestContext, origin: string) => {
	const key = loadComponentLibrary(origin);
	const seen: PlaylistSnapshot[] = [];
	const stop = subscribePlaylist(key, () => {
		seen.push(playlistSnapshot(key));
	});
	t.after(stop);
	await settle();
	return { key, seen };
};

const tickAt = async (origin: string, at: number) => {
	mock.timers.setTime(at);
	await store.retryFailedLibraryRead(origin);
	await settle();
};

const tryAgainAt = async (origin: string, at: number) => {
	mock.timers.setTime(at);
	await store.tryLibraryAgain(origin);
	await settle();
};

test("a failed library read holds the component's reason and detail, and no translated text", async (t) => {
	const origin = libraryOrigin();
	libraryPlayer(t, [
		refusedWith(413, { error: "library too large", detail: "30441 tracks" }),
	]);

	const { key } = await readLibrary(t, origin);
	const snapshot = playlistSnapshot(key);

	assert.equal(snapshot.isLoading, false);
	assert.deepEqual(
		{ reason: snapshot.failure?.reason, detail: snapshot.failure?.detail },
		{ reason: "too-large", detail: "library too large: 30441 tracks" },
	);
	assert.equal(snapshot.error, null);
	// The phrase is chosen when the notice is drawn, so a language switch
	// reaches a failure already held.
	const english = en["library.readTooLarge"];
	for (const [field, value] of Object.entries(snapshot)) {
		const text = value instanceof Error ? value.message : JSON.stringify(value);
		assert.ok(
			!text?.includes(english),
			`${field} holds the translated message`,
		);
	}
});

test("while the library is being built, loaded and total follow the build's progress", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [BUILDING]);
	player.build = { phase: "formatting", formatted: 8_192, total: 20_000 };

	const { key } = await readLibrary(t, origin);
	const wind = async (ms: number) => {
		for (let passed = 0; passed < ms; passed += 100) {
			mock.timers.tick(100);
			await settle();
		}
	};

	await wind(2_000);
	assert.deepEqual(
		(({ loaded, total, isLoading }) => ({ loaded, total, isLoading }))(
			playlistSnapshot(key),
		),
		{ loaded: 8_192, total: 20_000, isLoading: true },
	);

	player.build = { phase: "formatting", formatted: 16_384, total: 20_000 };
	await wind(10_000);
	assert.equal(playlistSnapshot(key).loaded, 16_384);
	assert.equal(playlistSnapshot(key).total, 20_000);
});

// Consecutive failures alternate between two transient reasons, so the wait
// is shown to grow with the run of failures rather than per reason.
test("a transient failure is asked again on the first tick 5 s after it, and the wait doubles after each further one up to 60 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
	]);
	await readLibrary(t, origin);
	assert.equal(player.exportsAsked, 1);

	const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
	let failedAt = 0;
	for (const [retry, wait] of waits.entries()) {
		await tickAt(origin, failedAt + wait - 1);
		assert.equal(
			player.exportsAsked,
			retry + 1,
			`asked again ${wait - 1} ms after failure ${retry + 1}, before its ${wait} ms wait`,
		);

		await tickAt(origin, failedAt + wait);
		assert.equal(
			player.exportsAsked,
			retry + 2,
			`not asked again ${wait} ms after failure ${retry + 1}`,
		);
		failedAt += wait;
	}
});

test("a read that succeeds puts the wait before the next transient failure is retried back to 5 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [
		SERVER_ERROR,
		SERVER_ERROR,
		SNAPSHOT_EXPORT,
		SERVER_ERROR,
	]);
	const { key } = await readLibrary(t, origin);
	await tickAt(origin, 5_000);
	await tickAt(origin, 15_000);
	assert.equal(player.exportsAsked, 3);
	assert.equal(playlistSnapshot(key).failure, null);

	// A moved structure is what makes the store export again after a success.
	const failedAt = 16_000;
	mock.timers.setTime(failedAt);
	await recheckComponentLibrary(origin, {
		structure: playlistSnapshot(key).structure + 1,
		revision: 0,
	});
	await settle();
	assert.equal(player.exportsAsked, 4);
	assert.equal(playlistSnapshot(key).failure?.reason, "failed");

	await tickAt(origin, failedAt + RETRY_MIN_MS - 1);
	assert.equal(player.exportsAsked, 4);
	await tickAt(origin, failedAt + RETRY_MIN_MS);
	assert.equal(
		player.exportsAsked,
		5,
		"the wait after a success carried on from the failures before it",
	);
});

test("a read refused, too large or unavailable is never asked again on its own", async (t) => {
	const refusals = [
		{ status: 400, reason: "refused" },
		{ status: 413, reason: "too-large" },
		{ status: 503, reason: "unavailable" },
	];
	const player = libraryPlayer(t, []);
	let at = 0;
	for (const { status, reason } of refusals) {
		const origin = libraryOrigin();
		player.exports = [refusedWith(status)];
		player.exportsAsked = 0;
		mock.timers.setTime(at);
		const { key } = await readLibrary(t, origin);
		assert.equal(playlistSnapshot(key).failure?.reason, reason);

		for (const wait of [RETRY_MIN_MS, RETRY_MAX_MS, 60 * RETRY_MAX_MS])
			await tickAt(origin, at + wait);
		assert.equal(player.exportsAsked, 1, `${reason} was asked again`);
		at += 60 * RETRY_MAX_MS;
	}
});

test("Try again after a transient failure asks at once, reads as reading while it runs, and puts the next wait back to 5 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [SERVER_ERROR]);
	const { key, seen } = await readLibrary(t, origin);
	// A second failure, so an automatic wait left running would be 10 s.
	await tickAt(origin, RETRY_MIN_MS);
	assert.equal(player.exportsAsked, 2);

	const pressedAt = RETRY_MIN_MS + 1_000;
	seen.length = 0;
	await tryAgainAt(origin, pressedAt);
	assert.equal(player.exportsAsked, 3, "Try again asked nothing");
	assert.ok(
		seen.some((snapshot) => snapshot.isLoading && snapshot.failure === null),
		"the read Try again started never read as reading",
	);
	assert.equal(playlistSnapshot(key).failure?.reason, "failed");

	await tickAt(origin, pressedAt + RETRY_MIN_MS - 1);
	assert.equal(player.exportsAsked, 3);
	await tickAt(origin, pressedAt + RETRY_MIN_MS);
	assert.equal(
		player.exportsAsked,
		4,
		"the wait after Try again carried on from the failures before it",
	);
});

test("Try again after a failure that is not transient asks nothing", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [refusedWith(413)]);
	const { key } = await readLibrary(t, origin);

	await tryAgainAt(origin, 1_000);

	assert.equal(player.exportsAsked, 1);
	assert.equal(playlistSnapshot(key).failure?.reason, "too-large");
});

// `GET /api/state` answers `304` once the player settles, so a rebuild noticed while the first read
// was still in flight has no later poll to announce it again: the look back after that read is the
// only one there will be, and a failed one has to be asked again.
test("a rebuild noticed mid-read is looked for again on a later tick when the first look back fails", async (t) => {
	const origin = libraryOrigin();
	let release = () => {};
	const until = new Promise<void>((resolve) => {
		release = resolve;
	});
	const player = libraryPlayer(t, [{ kind: "held", until }, SNAPSHOT_EXPORT]);
	await readLibrary(t, origin);

	const rebuilt = { structure: 424_242, revision: 0 };
	player.structure = rebuilt.structure;
	player.stateFailures = 1;
	await recheckComponentLibrary(origin, rebuilt);
	release();
	await settle();
	assert.equal(player.exportsAsked, 1);

	store.libraryPollFollower.answered(origin);
	await settle();
	assert.equal(player.exportsAsked, 2, "the rebuild was never read");
});
