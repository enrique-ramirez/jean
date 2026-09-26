import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { mock, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { StateDocument } from "../../src/shared/api/fooJean.ts";
import {
	fetchLibrary,
	type LibraryResult,
} from "../../src/shared/api/fooJeanLibrary.ts";
import { en } from "../../src/shared/i18n/en.ts";

const ORIGIN = "http://player.invalid:8881";
const COLUMNS = [...TRACK_EXPRESSIONS];

const SNAPSHOT = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "fixtures/library.jlib"),
);
const SNAPSHOT_TRACKS = 54;

type Build = NonNullable<StateDocument["library"]["build"]>;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const STALL_MS = 60 * SECOND;
const POLL_MAX_MS = 5 * SECOND;

const TOTAL = 20_000;

const STEP_MS = 100;

const building = (
	phase: Build["phase"],
	formatted = 0,
	total = TOTAL,
): Build => ({ phase, formatted, total });

interface Player {
	buildAt: (now: number) => Build | null;
	readyAt: number;
}

const libraryAt = (player: Player, now: number): StateDocument["library"] => {
	const ready = now >= player.readyAt;
	return {
		ready,
		structure: ready ? 1 : 0,
		revision: ready ? 1 : 0,
		trackCount: ready ? SNAPSHOT_TRACKS : 0,
		columns: ready ? COLUMNS : [],
		build: ready ? null : player.buildAt(now),
	};
};

const answer = (player: Player, url: string): Response => {
	const now = Date.now();
	const { pathname } = new URL(url);
	if (pathname === "/api/state")
		return Response.json({ library: libraryAt(player, now) });
	if (pathname === "/api/library/export")
		return now >= player.readyAt
			? new Response(SNAPSHOT)
			: new Response(null, { status: 202 });
	return new Response(null, { status: 404 });
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Run {
	settled: () => boolean;
	result: () => LibraryResult | undefined;
	until: (at: number) => Promise<void>;
	progress: Build[];
}

const start = (t: TestContext, player: Player): Run => {
	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	globalThis.fetch = ((input: RequestInfo | URL) =>
		Promise.resolve(answer(player, String(input)))) as typeof fetch;

	const stop = new AbortController();
	t.after(() => {
		stop.abort();
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	const progress: Build[] = [];
	let settled = false;
	let result: LibraryResult | undefined;
	fetchLibrary(ORIGIN, COLUMNS, stop.signal, (build: Build) => {
		progress.push(build);
	}).then(
		(value) => {
			settled = true;
			result = value;
		},
		() => {
			settled = true;
		},
	);

	return {
		settled: () => settled,
		result: () => result,
		progress,
		until: async (at) => {
			while (Date.now() < at && !settled) {
				await flush();
				await flush();
				mock.timers.tick(Math.min(STEP_MS, at - Date.now()));
			}
			await flush();
			await flush();
		},
	};
};

const failedWith = (run: Run) => {
	const result = run.result();
	return result && !result.ok ? result.reason : null;
};

test("a build that keeps moving is waited out past five minutes and answers the snapshot once it is ready", async (t) => {
	const readyAt = 6 * MINUTE + 30 * SECOND;
	// One slice finishes every fifty seconds: slower than any poll, and inside the stall allowance.
	const run = start(t, {
		buildAt: (now) =>
			building("formatting", Math.floor(now / (50 * SECOND)) * 100),
		readyAt,
	});

	await run.until(6 * MINUTE);
	assert.equal(
		run.settled(),
		false,
		`settled at six minutes with ${failedWith(run) ?? "a result"} while the build was still moving`,
	);

	await run.until(readyAt + 2 * POLL_MAX_MS);
	const result = run.result();
	assert.ok(result?.ok, `answered ${failedWith(run)} rather than the snapshot`);
	assert.equal(result.library.trackCount, SNAPSHOT_TRACKS);
});

test("a build standing still answers timeout once sixty seconds pass without movement, and not a second before", async (t) => {
	const run = start(t, {
		buildAt: () => building("formatting", 8_192),
		readyAt: Number.POSITIVE_INFINITY,
	});

	await run.until(STALL_MS - SECOND);
	assert.equal(
		run.settled(),
		false,
		`answered ${failedWith(run)} before the build had stood still for sixty seconds`,
	);

	await run.until(STALL_MS + POLL_MAX_MS);
	assert.equal(failedWith(run), "timeout");
});

// `phase` moves while `formatted` and `total` stand still: `ordering` has no count of
// its own, and the step from it to `formatting` changes nothing but the name.
test("a build whose only change is its phase has moved, and the sixty seconds start again from there", async (t) => {
	const phaseMovesAt = 50 * SECOND;
	const run = start(t, {
		buildAt: (now) => building(now < phaseMovesAt ? "ordering" : "formatting"),
		readyAt: Number.POSITIVE_INFINITY,
	});

	await run.until(phaseMovesAt + STALL_MS - SECOND);
	assert.equal(
		run.settled(),
		false,
		`answered ${failedWith(run)} while the phase had moved less than sixty seconds before`,
	);

	await run.until(phaseMovesAt + STALL_MS + 2 * POLL_MAX_MS);
	assert.equal(failedWith(run), "timeout");
});

test("a build appearing where none was running has moved, and the sixty seconds start again from there", async (t) => {
	const buildStartsAt = 50 * SECOND;
	const run = start(t, {
		buildAt: (now) => (now < buildStartsAt ? null : building("listing", 0, 0)),
		readyAt: Number.POSITIVE_INFINITY,
	});

	await run.until(buildStartsAt + STALL_MS - SECOND);
	assert.equal(
		run.settled(),
		false,
		`answered ${failedWith(run)} while the build had started less than sixty seconds before`,
	);

	await run.until(buildStartsAt + STALL_MS + 2 * POLL_MAX_MS);
	assert.equal(failedWith(run), "timeout");
});

test("onProgress hears each build the player reports once, in the order reported, and never hears null", async (t) => {
	const refreshing = building("formatting", 8_192, TOTAL + 1);
	const listing = building("listing", 0, 0);
	const ordering = building("ordering");
	const formatting = building("formatting", 8_192);
	const readyAt = 70 * SECOND;
	// A rebuild of another column set is running when the call starts, and the
	// one asked for starts after a gap with no build at all. Each stage outlasts
	// several polls, so a callback fired per poll hears it more than once.
	const run = start(t, {
		buildAt: (now) => {
			if (now < 15 * SECOND) return refreshing;
			if (now < 25 * SECOND) return null;
			if (now < 35 * SECOND) return listing;
			if (now < 50 * SECOND) return ordering;
			return formatting;
		},
		readyAt,
	});

	await run.until(readyAt + 2 * POLL_MAX_MS);

	assert.ok(run.result()?.ok, `answered ${failedWith(run)}`);
	assert.deepEqual(run.progress, [refreshing, listing, ordering, formatting]);
});

test("the timeout message says foo_jean stopped making progress on the library, not that it is still building", () => {
	const message = en["library.readTimedOut"];

	assert.match(message, /foo_jean/);
	assert.match(message, /stopped making progress/);
	assert.match(message, /library/);
	assert.doesNotMatch(message, /still building/);
});
