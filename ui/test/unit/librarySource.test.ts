import assert from "node:assert/strict";
import test, { mock } from "node:test";

import type { LibrarySource } from "../../src/domain/track/librarySource.ts";
import { librarySourceOf } from "../../src/domain/track/librarySource.ts";
import { pathCollector } from "../../src/domain/track/pathTable.ts";
import type { Refs } from "../../src/domain/track/project.ts";

const ORIGIN = "http://player.invalid:8881";
const TARGET_GUID = "{5a1d0000-0000-0000-0000-000000000001}";
const PLAYLIST_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

// The playlist generation the rows on screen were read at. Past 2^53, because
// one that made a round trip through a JavaScript number would come back
// naming a different generation, which the component answers with a 409.
const STRUCTURE = "9204739866101318923";

const TRACK = "Fictional Artist/Imaginary Album/01 Track.flac";

// Every subsong of a cue sheet shares one library path, so the subsong is the
// half of the library address that tells two of them apart.
const CUE = "Fictional Artist/Imaginary Album/album.flac";

const LIBRARY_PATHS = [TRACK, CUE, CUE];
const LIBRARY_SUBSONGS = Int32Array.of(0, 1, 2);

// The third row is one the media library does not hold: `foo_jean` sends the
// empty string for a row it can compute no library path for.
const PLAYLIST_PATHS = [TRACK, CUE, ""];
const PLAYLIST_SUBSONGS = Int32Array.of(0, 2, 0);

const REFS: Refs = Int32Array.of(0, 1, 2);

// Longer than the longest budget a foo_jean call holds, so a call that spends
// all of its own has still settled once this much clock has passed.
const LONGEST_WAIT_MS = 120_000;

// One per request the deepest call makes. Each request is timed from its own
// start, so each needs the clock wound again.
const AWAITED_STEPS = 1;

const pathTableOf = (paths: string[]) => {
	const collector = pathCollector();
	for (const path of paths) collector.add(path);
	return collector.table();
};

const librarySource = (
	paths: string[] = LIBRARY_PATHS,
	subsongs: Int32Array = LIBRARY_SUBSONGS,
): LibrarySource =>
	librarySourceOf({
		kind: "library",
		paths: pathTableOf(paths),
		subsongs,
		artworkOrigin: ORIGIN,
	});

const playlistSource = ({
	paths = PLAYLIST_PATHS,
	subsongs = PLAYLIST_SUBSONGS,
	structure,
}: {
	paths?: string[];
	subsongs?: Int32Array;
	structure?: string;
} = {}): LibrarySource =>
	librarySourceOf({
		kind: "playlist",
		playlistId: PLAYLIST_GUID,
		origin: ORIGIN,
		paths: pathTableOf(paths),
		subsongs,
		structure,
	});

const stallEveryRequest = () => {
	globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
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
	run: (source: LibrarySource) => Promise<unknown>;
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
		run: (source) => source.addTo(TARGET_GUID, REFS),
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

test("a library row is addressed by the path and the subsong the snapshot holds", () => {
	const source = librarySource();

	assert.deepEqual(source.address(0), {
		kind: "library",
		track: TRACK,
		subsong: 0,
	});
	assert.deepEqual(source.address(2), {
		kind: "library",
		track: CUE,
		subsong: 2,
	});
});

test("a library row the snapshot holds no path for has no address", () => {
	assert.equal(librarySource([""], Int32Array.of(0)).address(0), null);
	assert.equal(librarySource().address(LIBRARY_PATHS.length), null);
});

test("a playlist row the media library holds is addressed by its library path, never by its position", () => {
	assert.deepEqual(playlistSource({ structure: STRUCTURE }).address(1), {
		kind: "library",
		track: CUE,
		subsong: 2,
	});
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
	const source = playlistSource();

	assert.equal(source.address(2), null);
	// The generation guards a position and nothing else, so a row the library
	// does hold still answers its own address without one.
	assert.deepEqual(source.address(0), {
		kind: "library",
		track: TRACK,
		subsong: 0,
	});
});

test("addressing a row asks the player nothing", (t) => {
	const realFetch = globalThis.fetch;
	const asked: string[] = [];
	globalThis.fetch = ((input: RequestInfo | URL) => {
		asked.push(String(input));
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
