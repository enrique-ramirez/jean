import assert from "node:assert/strict";
import test, { mock } from "node:test";

import type { LibrarySource } from "../../src/domain/track/librarySource.ts";
import {
	playlistSourceOf,
	windowedSourceOf,
} from "../../src/domain/track/librarySource.ts";
import type { Refs } from "../../src/domain/track/project.ts";

const ORIGIN = "http://player.invalid:8881";
const TARGET_GUID = "{5a1d0000-0000-0000-0000-000000000001}";
const PLAYLIST_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

// The playlist generation the rows on screen were read at. Past 2^53, because
// one that made a round trip through a JavaScript number would come back
// naming a different generation, which the component answers with a 409.
const STRUCTURE = "9204739866101318923";

const REFS: Refs = Int32Array.of(0, 1, 2);

// Longer than the longest budget a foo_jean call holds, so a call that spends
// all of its own has still settled once this much clock has passed.
const LONGEST_WAIT_MS = 120_000;

// One per request the deepest call makes. Each request is timed from its own
// start, so each needs the clock wound again.
const AWAITED_STEPS = 1;

type MediaLibrarySource = Extract<LibrarySource, { kind: "library" }>;

const librarySource = (): MediaLibrarySource =>
	windowedSourceOf({
		windows: { at: () => null },
		origin: ORIGIN,
		listNow: () => ({
			kind: "library",
			id: "library",
			structure: 0,
			length: REFS.length,
			ordinals: null,
		}),
		coverOf: () => null,
	});

const playlistSource = ({
	structure,
}: {
	structure?: string;
} = {}): LibrarySource =>
	playlistSourceOf({ playlistId: PLAYLIST_GUID, origin: ORIGIN, structure });

const stallEveryRequest = () => {
	globalThis.fetch = ((request: Request) =>
		new Promise<Response>((_resolve, reject) => {
			const signal = request.signal;
			if (!signal) return;
			if (signal.aborted) reject(signal.reason);
			else signal.addEventListener("abort", () => reject(signal.reason));
		})) as typeof fetch;
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
	run: (source: MediaLibrarySource) => Promise<unknown>;
}

const CALLS: Call[] = [
	{
		name: "playing a library view",
		run: (source) => source.fill("All music", REFS),
	},
	{
		name: "queueing library rows",
		run: (source) => source.queueTargets(REFS),
	},
	{
		name: "adding library rows to a playlist",
		run: (source) => source.addTo(TARGET_GUID, REFS, "add"),
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
		stallEveryRequest();
		assert.ok(
			await settles(run(librarySource())),
			`${name}: never settled, however far the clock was wound`,
		);
	}
});

test("a playlist row the media library does not hold is addressed by its position and the generation it was read at", () => {
	assert.deepEqual(playlistSource({ structure: STRUCTURE }).address(2), {
		kind: "playlist",
		playlist: PLAYLIST_GUID,
		index: 2,
		structure: STRUCTURE,
	});
});

test("a playlist source given no generation has no address for a row the media library does not hold", () => {
	assert.equal(playlistSource().address(2), null);
});

test("addressing a row asks the player nothing", (t) => {
	const realFetch = globalThis.fetch;
	const asked: string[] = [];
	globalThis.fetch = ((request: Request) => {
		asked.push(request.url);
		return new Promise<Response>(() => undefined);
	}) as typeof fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});

	const library = librarySource();
	const playlist = playlistSource({ structure: STRUCTURE });
	for (const ref of REFS) {
		library.address(ref);
		playlist.address(ref);
	}

	assert.deepEqual(asked, []);
});
