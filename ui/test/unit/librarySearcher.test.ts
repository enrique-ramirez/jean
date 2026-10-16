import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { FIELD } from "../../src/domain/track/fields.ts";
import type * as Searcher from "../../src/domain/track/librarySearcher.ts";
import type { SearchClient } from "../../src/domain/track/searchClient.ts";
import type { SearchQuestion } from "../../src/domain/track/searchCore.ts";
import {
	columnsOf,
	freshKey,
	generatedLibrary,
	mainThreadSearch,
	patched,
} from "./searchLibraries.ts";
import { installStubWorker, type StubWorker } from "./stubWorker.ts";

const QUESTION = {
	kind: "search",
	query: "a",
	limit: 8,
	splitsCredits: true,
} as const satisfies SearchQuestion;

let searchers = 0;

async function freshSearcher(t: TestContext) {
	const workers = installStubWorker();
	t.after(workers.uninstall);
	searchers += 1;
	const module: typeof Searcher = await import(
		`../../src/domain/track/librarySearcher.ts?case=${searchers}`
	);
	const client = module.librarySearcher();
	assert.ok(client, "no searcher with a Worker to start");
	return { client, spawned: workers.spawned };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, what: string) {
	for (let turns = 0; turns < 200; turns += 1) {
		if (condition()) return;
		await turn();
	}
	assert.fail(`never happened: ${what}`);
}

const turns = async (count: number) => {
	for (let at = 0; at < count; at += 1) await turn();
};

function handOver(client: SearchClient, exported: ArrayBuffer) {
	const columns = columnsOf(exported);
	client.load(exported.slice(0));
	client.mirror(columns);
	return columns;
}

const matchedOf = (answer: { matched: ArrayLike<number> | null } | null) =>
	answer?.matched == null ? null : Array.from(answer.matched);

const expectedMatches = (columns: ReturnType<typeof columnsOf>) =>
	mainThreadSearch(
		columns,
		freshKey(),
		QUESTION.query,
		QUESTION.limit,
		QUESTION.splitsCredits,
	).matched;

async function untilNoWorkerIsLeft(spawned: StubWorker[]) {
	const failed = new Set<StubWorker>();
	for (let round = 0; round < 8; round += 1) {
		const started = spawned.length;
		for (const worker of [...spawned])
			if (!failed.has(worker)) {
				failed.add(worker);
				worker.fail();
			}
		await turns(10);
		if (spawned.length === started) return;
	}
	assert.fail("the page went on starting workers");
}

test("a worker that fails is terminated and replaced, and the next question is answered by the new one", async (t) => {
	const { client, spawned } = await freshSearcher(t);
	const columns = handOver(client, generatedLibrary(4, 300).exported());
	const expected = expectedMatches(columns);
	assert.deepEqual(matchedOf(await client.ask(QUESTION)), expected);

	spawned[0].fail();
	await until(() => spawned.length === 2, "a second worker was started");
	assert.equal(
		spawned[0].isTerminated,
		true,
		"the failed worker was left running",
	);

	spawned[1].hold();
	let isSettled = false;
	const asked = client.ask(QUESTION).finally(() => {
		isSettled = true;
	});
	await turns(50);
	assert.equal(
		isSettled,
		false,
		"answered while the new worker was held back, so not by a worker",
	);

	spawned[1].release();
	assert.deepEqual(matchedOf(await asked), expected);
});

test("a replacement that fails as well leaves the questions to the page, and no third worker is started", async (t) => {
	const { client, spawned } = await freshSearcher(t);
	const columns = handOver(client, generatedLibrary(5, 300).exported());
	const expected = expectedMatches(columns);

	spawned[0].fail();
	await until(() => spawned.length === 2, "a second worker was started");
	spawned[1].fail();
	await turns(50);

	assert.equal(spawned.length, 2, "workers started");
	assert.deepEqual(matchedOf(await client.ask(QUESTION)), expected);
});

test("on the page's own thread, a question after a play folds no more than the same question asked again", async (t) => {
	const { client, spawned } = await freshSearcher(t);
	await untilNoWorkerIsLeft(spawned);

	const library = generatedLibrary(6, 3_000);
	const before = columnsOf(library.exported());
	const played = patched(
		before,
		library.change([{ ordinal: 7, field: FIELD.playCount, value: "61" }]),
	);
	client.load(library.exported().slice(0));
	client.mirror(before);

	const normalize = t.mock.method(String.prototype, "normalize");
	const foldsDuring = async () => {
		const from = normalize.mock.callCount();
		const answer = await client.ask(QUESTION);
		assert.ok(answer, "the page answered nothing");
		return normalize.mock.callCount() - from;
	};

	const first = await foldsDuring();
	const titles = new Set(library.rows.map((row) => row[FIELD.title])).size;
	assert.ok(
		first >= titles,
		`the first question folded ${first} values, fewer than the ${titles} titles it searched`,
	);
	const again = await foldsDuring();

	client.mirror(played);
	const afterThePlay = await foldsDuring();
	assert.ok(
		afterThePlay <= again,
		`a question after a play folded ${afterThePlay} values, where the same question asked again folded ${again}`,
	);
});

test("on the page's own thread, a question after another library was handed over is answered from that library", async (t) => {
	const { client, spawned } = await freshSearcher(t);
	await untilNoWorkerIsLeft(spawned);

	handOver(client, generatedLibrary(7, 300).exported());
	await client.ask(QUESTION);

	const next = handOver(client, generatedLibrary(8, 300).exported());
	assert.deepEqual(
		matchedOf(await client.ask(QUESTION)),
		expectedMatches(next),
	);
});
