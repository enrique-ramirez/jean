import assert from "node:assert/strict";
import test from "node:test";

import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import { librarySearcher } from "../../src/domain/track/librarySearcher.ts";
import { playlistSnapshot } from "../../src/domain/track/playlistEntries.ts";
import type { SearchQuestion } from "../../src/domain/track/searchCore.ts";
import {
	freshKey,
	generatedLibrary,
	mainThreadSearch,
} from "./searchLibraries.ts";
import { installStubWorker } from "./stubWorker.ts";

installStubWorker();

const ORIGIN = "http://landing.invalid:8881";

const QUESTION = {
	kind: "search",
	query: "a",
	limit: 8,
	splitsCredits: false,
} as const satisfies SearchQuestion;

const ON_SCREEN = generatedLibrary(1, 40);
const NEXT = generatedLibrary(2, 2_000);

const turn = () => new Promise((resolve) => setImmediate(resolve));

const task = () =>
	new Promise<void>((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = () => {
			port1.close();
			resolve();
		};
		port2.postMessage(null);
	});

const matchesOver = (columns: ReturnType<typeof playlistSnapshot>["columns"]) =>
	mainThreadSearch(
		columns,
		freshKey(),
		QUESTION.query,
		QUESTION.limit,
		QUESTION.splitsCredits,
	).matched;

function playerServing(exports: ArrayBuffer[]) {
	let asked = 0;
	globalThis.fetch = ((request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/api/library/export") {
			const body = exports[Math.min(asked, exports.length - 1)];
			asked += 1;
			return Promise.resolve(new Response(body.slice(0)));
		}
		if (pathname === "/api/library/changes")
			return Promise.resolve(
				Response.json(
					{ error: "changes unavailable", detail: "" },
					{ status: 410 },
				),
			);
		return Promise.reject(new TypeError("fetch failed"));
	}) as typeof fetch;
	return { exportsAsked: () => asked };
}

test("while a new export lands, every answer handed back is about the library on screen when it arrives", async (t) => {
	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
	const player = playerServing([ON_SCREEN.exported(), NEXT.exported()]);

	const key = loadComponentLibrary(ORIGIN);
	const shows = (count: number) =>
		playlistSnapshot(key).columns.trackCount === count &&
		!playlistSnapshot(key).isLoading;
	for (let at = 0; at < 500 && !shows(ON_SCREEN.rows.length); at += 1)
		await turn();
	assert.ok(shows(ON_SCREEN.rows.length), "the first library was never drawn");

	const searcher = librarySearcher();
	assert.ok(searcher);
	const before = matchesOver(playlistSnapshot(key).columns);

	const checked: {
		answered: number[] | null;
		onScreen: number[] | null;
		trackCount: number;
	}[] = [];
	let askedWhileLanding = 0;
	const ask = () =>
		searcher.ask(QUESTION).then((answer) => {
			if (answer === null) return;
			const { columns } = playlistSnapshot(key);
			checked.push({
				answered: answer.matched && Array.from(answer.matched),
				onScreen: matchesOver(columns),
				trackCount: columns.trackCount,
			});
		});

	let clock = performance.now();
	t.mock.method(performance, "now", () => {
		clock += 50;
		return clock;
	});

	const asks: Promise<void>[] = [];
	void recheckComponentLibrary(ORIGIN, {
		structure: playlistSnapshot(key).structure + 1,
		revision: 0,
	});
	for (let at = 0; at < 5_000 && !shows(NEXT.rows.length); at += 1) {
		if (player.exportsAsked() === 2) askedWhileLanding += 1;
		asks.push(ask());
		await task();
	}
	assert.ok(shows(NEXT.rows.length), "the new library was never drawn");
	for (let at = 0; at < 5; at += 1) {
		asks.push(ask());
		await turn();
	}
	await Promise.all(asks);

	const after = matchesOver(playlistSnapshot(key).columns);
	assert.notDeepEqual(before, after, "the two libraries answer alike");
	assert.ok(
		askedWhileLanding > 0,
		"no question was asked between the new export and its drawing",
	);
	for (const { answered, onScreen, trackCount } of checked)
		assert.deepEqual(
			answered,
			onScreen,
			`an answer handed back while ${trackCount} rows were on screen is about other rows`,
		);
});
