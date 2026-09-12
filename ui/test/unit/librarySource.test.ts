import assert from "node:assert/strict";
import test, { mock } from "node:test";

import type { LibrarySource } from "../../src/domain/track/librarySource.ts";
import { librarySourceOf } from "../../src/domain/track/librarySource.ts";
import { pathCollector } from "../../src/domain/track/pathTable.ts";
import type { Refs } from "../../src/domain/track/project.ts";

const ORIGIN = "http://player.invalid:8881";
const TOKEN = "token";
const TARGET_PLAYLIST = "p3";
const TARGET_GUID = "{5a1d0000-0000-0000-0000-000000000001}";

const REFS: Refs = Int32Array.of(0, 1, 2);

// Longer than the longest budget a foo_jean call holds, so a call that spends
// all of its own has still settled once this much clock has passed.
const LONGEST_WAIT_MS = 120_000;

// One per step a call takes before it reaches the component: `addTo` reads the
// playlist annotations first, and the queue asks for its holding playlist.
const AWAITED_STEPS = 6;

const librarySource = (): LibrarySource => {
	const collector = pathCollector();
	for (const path of ["A/one.mp3", "A/two.mp3", "A/three.mp3"])
		collector.add(path);

	return librarySourceOf({
		kind: "library",
		paths: collector.table(),
		subsongs: new Int32Array(3),
		artworkOrigin: ORIGIN,
		token: TOKEN,
	});
};

const ANNOTATIONS = {
	playlists: [{ id: TARGET_GUID, beefwebId: TARGET_PLAYLIST }],
};

const answerFor = (url: string) =>
	url.endsWith("/api/playlists") ? ANNOTATIONS : undefined;

const stallEverythingElse = () => {
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const answer = answerFor(String(input));
		if (answer !== undefined)
			return Promise.resolve(
				new Response(JSON.stringify(answer), {
					headers: { "Content-Type": "application/json" },
				}),
			);

		return new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) return;
			if (signal.aborted) reject(signal.reason);
			else signal.addEventListener("abort", () => reject(signal.reason));
		});
	}) as typeof fetch;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settles = async (call: Promise<unknown>) => {
	let done = false;
	const mark = () => {
		done = true;
	};
	void call.then(mark, mark);

	for (let step = 0; step < AWAITED_STEPS && !done; step += 1) {
		await flush();
		mock.timers.tick(LONGEST_WAIT_MS);
	}
	await flush();

	return done;
};

interface Call {
	name: string;
	run: (source: LibrarySource) => Promise<unknown>;
}

const CALLS: Call[] = [
	{
		name: "playing a library view",
		run: (source) => source.fill("All music", REFS, { token: TOKEN }),
	},
	{
		name: "queueing library rows",
		run: (source) =>
			source.queueTargets(
				REFS,
				async () => ({ id: TARGET_PLAYLIST, itemCount: 0 }),
				{ token: TOKEN },
			),
	},
	{
		name: "adding library rows to a playlist",
		run: (source) => source.addTo(TARGET_PLAYLIST, REFS),
	},
];

test("a component call that never answers settles rather than leaving the caller waiting", async (t) => {
	const realFetch = globalThis.fetch;
	// The mocked clock reaches `setTimeout`, which is what `withTimeout` in the
	// api client runs on. A call timed by `AbortSignal.timeout` instead keeps a
	// timer node cannot advance, and would read here as one that never settles.
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => {
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	for (const { name, run } of CALLS) {
		stallEverythingElse();
		assert.ok(
			await settles(run(librarySource())),
			`${name}: never settled, however far the clock was wound`,
		);
	}
});
