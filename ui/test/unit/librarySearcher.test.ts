import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { showColumns } from "../../src/domain/track/libraryLanding.ts";
import type * as Searcher from "../../src/domain/track/librarySearcher.ts";
import { librarySearcher } from "../../src/domain/track/librarySearcher.ts";
import { columnsOf, generatedLibrary } from "./searchLibraries.ts";
import { installStubWorker } from "./stubWorker.ts";

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
	return client;
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, what: string) {
	for (let turns = 0; turns < 200; turns += 1) {
		if (condition()) return;
		await turn();
	}
	assert.fail(`never happened: ${what}`);
}

test("the searcher offers no way to ask a question of the worker, or to hand it the library's columns", async (t) => {
	const searcher = await freshSearcher(t);
	for (const name of ["ask", "version", "mirror"])
		assert.ok(!(name in searcher), `the searcher still has ${name}`);
});

test("a worker that fails after the library was shown is not replaced, and what was asked of the store before the failure or after it settles as nothing", async (t) => {
	const workers = installStubWorker();
	t.after(workers.uninstall);
	const client = librarySearcher();
	assert.ok(client, "no searcher with a Worker to start");

	const exported = generatedLibrary(4, 300).exported();
	client.load(exported.slice(0));
	showColumns(columnsOf(exported));

	t.mock.timers.enable({ apis: ["setTimeout"] });
	const settled: unknown[] = [];
	void client.stored().then((copy) => settled.push(copy));
	workers.spawned[0].fail();
	void client.restore().then((events) => settled.push(events));
	await until(() => settled.length === 2, "both were answered");

	assert.equal(workers.spawned.length, 1, "workers started");
	assert.deepEqual(settled, [null, null]);
});
