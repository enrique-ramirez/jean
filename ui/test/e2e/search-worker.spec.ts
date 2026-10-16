import { artistRoute, href } from "../../src/domain/track/routes.ts";
import type { Page } from "./fixtures.ts";
import { expect, openAllMusic, searchFor, test, trackRow } from "./fixtures.ts";

const SONG = "Nutshell";
const ARTIST = "Babasónicos";
const ARTIST_TRACK = "Deléctrico";

// A worker whose script throws as it loads, as one does that cannot start: the `Worker` reports an
// `error` and nothing it is sent is ever answered.
const WORKER_FAILS_TO_LOAD = () => {
	const dying = URL.createObjectURL(
		new Blob(['throw new Error("the search worker failed to start");'], {
			type: "text/javascript",
		}),
	);
	window.Worker = class extends window.Worker {
		constructor(_url: string | URL, options?: WorkerOptions) {
			super(dying, options);
		}
	};
};

// A worker the browser ends partway through the visit, as it ends one that ran out of memory: no
// `error` is reported, and nothing is answered after it.
const WORKER_ENDED_ON_CUE = () => {
	const started: Worker[] = [];
	const Real = window.Worker;
	window.Worker = class extends Real {
		constructor(url: string | URL, options?: WorkerOptions) {
			super(url, options);
			started.push(this);
		}
	};
	Reflect.set(window, "endWorkers", () => {
		for (const worker of started) worker.terminate();
		return started.length;
	});
};

const endWorkers = (page: Page) =>
	page.evaluate(() => (Reflect.get(window, "endWorkers") as () => number)());

const expectSearchAnswers = async (page: Page) => {
	await searchFor(page, SONG.toLowerCase());
	await expect(trackRow(page, 0)).toContainText(SONG);
};

const expectArtistTracksListed = async (page: Page) => {
	await page.evaluate(
		(hash) => {
			location.hash = hash;
		},
		href(artistRoute(ARTIST, "tracks")),
	);
	await expect(
		page.getByRole("heading", { level: 1, name: ARTIST }),
	).toBeVisible();
	await expect(
		page.locator('[role="row"]').filter({ hasText: ARTIST_TRACK }).first(),
	).toBeVisible();
};

test.describe("a search worker that fails to start", () => {
	test.beforeEach(({ page }) => page.addInitScript(WORKER_FAILS_TO_LOAD));

	test("a search still shows its results", async ({ page }) => {
		await openAllMusic(page);
		await expectSearchAnswers(page);
	});

	test("an artist's page still lists their tracks", async ({ page }) => {
		await openAllMusic(page);
		await expectArtistTracksListed(page);
	});
});

test.describe("a search worker that stops partway through a visit", () => {
	test.beforeEach(({ page }) => page.addInitScript(WORKER_ENDED_ON_CUE));

	test("a search asked after it stopped still shows its results", async ({
		page,
	}) => {
		await openAllMusic(page);
		expect(await endWorkers(page), "workers started").toBeGreaterThan(0);
		await expectSearchAnswers(page);
	});

	test("an artist's page opened after it stopped still lists their tracks", async ({
		page,
	}) => {
		await openAllMusic(page);
		expect(await endWorkers(page), "workers started").toBeGreaterThan(0);
		await expectArtistTracksListed(page);
	});
});
