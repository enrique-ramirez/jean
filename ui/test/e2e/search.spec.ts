import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
} from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	playedFrom,
	requestsTo,
	revealSearch,
	runClockFor,
	searchField,
	searchFor,
	test,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

// Jean's worker answers reach the page as `message` events on the `Worker` object it constructed;
// holding them back relies on that.

const ARTIST = "Babasónicos";
const ALBUM = "Jessico";
const GENRE = "Grunge";
const NAMES_THE_ARTIST = "babasonicos";
const NAMES_A_SONG = "nutshell";
const SONG = "Nutshell";
const LOADING = en["library.reading"];

interface Watch {
	name: string;
	selector: string;
	text?: string;
	exact?: boolean;
}

interface Harness {
	hold: () => void;
	release: () => void;
	held: () => number;
	delivered: () => number;
	workers: () => number;
	releasedAt: () => number | null;
	watch: (watch: Watch) => void;
	firstSeen: (name: string) => number | null;
	open: (hash: string) => number;
}

declare global {
	interface Window {
		__workerHarness: Harness;
	}
}

const watchTheWorker = (page: Page) =>
	page.addInitScript(() => {
		const held: (() => void)[] = [];
		let holding = false;
		let delivered = 0;
		let workers = 0;
		let releasedAt: number | null = null;
		const passing = new WeakSet<Event>();

		const Real = window.Worker;
		window.Worker = class extends Real {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				workers += 1;
				// Added in the constructor, so it runs ahead of every listener Jean adds and ahead of
				// `onmessage`, and can stop an event before either sees it.
				this.addEventListener("message", (event) => {
					if (passing.has(event) || !holding) {
						delivered += 1;
						return;
					}
					event.stopImmediatePropagation();
					held.push(() => {
						const again = new MessageEvent("message", {
							data: event.data,
							ports: [...event.ports],
						});
						passing.add(again);
						this.dispatchEvent(again);
					});
				});
			}
		};

		const watches: Watch[] = [];
		const seen = new Map<string, number>();
		const shows = ({ selector, text, exact }: Watch) =>
			[...document.querySelectorAll(selector)].some((element) => {
				const drawn = element.textContent ?? "";
				return text === undefined
					? true
					: exact
						? drawn.trim() === text
						: drawn.includes(text);
			});
		const look = () => {
			for (const watch of watches) {
				if (seen.has(watch.name)) continue;
				const isMet = watch.text === undefined ? !shows(watch) : shows(watch);
				if (isMet) seen.set(watch.name, performance.now());
			}
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});

		window.__workerHarness = {
			hold: () => {
				holding = true;
			},
			release: () => {
				holding = false;
				releasedAt = performance.now();
				for (const send of held.splice(0)) send();
			},
			held: () => held.length,
			delivered: () => delivered,
			workers: () => workers,
			releasedAt: () => releasedAt,
			watch: (watch) => {
				watches.push(watch);
				look();
			},
			firstSeen: (name) => seen.get(name) ?? null,
			open: (hash) => {
				const at = performance.now();
				window.location.hash = hash;
				return at;
			},
		};
	});

const hold = (page: Page) => page.evaluate(() => window.__workerHarness.hold());
const release = (page: Page) =>
	page.evaluate(() => window.__workerHarness.release());
const watch = (page: Page, what: Watch) =>
	page.evaluate((one) => window.__workerHarness.watch(one), what);
const firstSeen = (page: Page, name: string) =>
	page.evaluate((one) => window.__workerHarness.firstSeen(one), name);
const releasedAt = (page: Page) =>
	page.evaluate(() => window.__workerHarness.releasedAt());
const delivered = (page: Page) =>
	page.evaluate(() => window.__workerHarness.delivered());
const open = (page: Page, route: string) =>
	page.evaluate((hash) => window.__workerHarness.open(hash), `#/${route}`);

const untilAnAnswerIsHeld = (page: Page) =>
	expect
		.poll(() => page.evaluate(() => window.__workerHarness.held()), {
			message: "Jean's search worker answered nothing that could be held",
		})
		.toBeGreaterThan(0);

const untilDeliveredPast = (page: Page, before: number) =>
	expect
		.poll(() => delivered(page), {
			message: "no answer from Jean's search worker reached the page",
		})
		.toBeGreaterThan(before);

const expectNotSeenWhileHeld = async (page: Page, name: string) => {
	const at = await firstSeen(page, name);
	const released = await releasedAt(page);
	expect(released, "the answer was never released").not.toBeNull();
	if (at !== null)
		expect(at, `${name} was drawn before the answer arrived`).toBeGreaterThan(
			released as number,
		);
};

const options = (page: Page) => page.getByRole("option");

const openWithSearch = async (page: Page) => {
	await openLibrary(page);
	await revealSearch(page);
};

const WARMED_UP = "Alice in Chains";
const WARM_UP = artistRoute(WARMED_UP);

const warmUp = async (page: Page) => {
	await openLibrary(page);
	const before = await delivered(page);
	await open(page, WARM_UP);
	await expect(
		page.getByRole("heading", { name: en["artist.discography"] }),
	).toBeVisible();
	await untilDeliveredPast(page, before);
};

const PAGES: {
	kind: string;
	route: string;
	drawn: (page: Page) => Locator;
}[] = [
	{
		kind: "an album",
		route: albumRoute(ARTIST, ALBUM),
		drawn: (page) => trackRow(page, 0),
	},
	{
		kind: "an artist",
		route: artistRoute(ARTIST),
		drawn: (page) =>
			page.getByRole("heading", { name: en["artist.discography"] }),
	},
	{
		kind: "a genre",
		route: genreRoute(GENRE),
		drawn: (page) => trackRow(page, 0),
	},
];

const loading = (page: Page) => page.locator("main").getByText(LOADING);

test.describe("while the search worker has not answered", () => {
	test.beforeEach(({ page }) => watchTheWorker(page));

	test("the suggestions already drawn stay until the typed query's own arrive", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(NAMES_THE_ARTIST);
		await expect(options(page).first()).toContainText(ARTIST);

		await watch(page, {
			name: "the song's suggestion",
			selector: '[role="option"]',
			text: SONG,
		});
		await hold(page);
		await searchField(page).fill(NAMES_A_SONG);
		await untilAnAnswerIsHeld(page);

		await expect(options(page).first()).toContainText(ARTIST);

		await release(page);
		await expect(options(page).filter({ hasText: SONG })).toHaveCount(1);
		await expect(options(page).filter({ hasText: ARTIST })).toHaveCount(0);
		await expectNotSeenWhileHeld(page, "the song's suggestion");
	});

	test("the results page keeps the rows it drew until the new query's arrive", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchFor(page, NAMES_THE_ARTIST);
		const drawn = (await trackRow(page, 0).textContent()) ?? "";

		await watch(page, {
			name: "the song's row",
			selector: '[role="row"]',
			text: SONG,
		});
		await watch(page, { name: "an empty list", selector: '[role="row"]' });
		await hold(page);
		await open(page, searchRoute(NAMES_A_SONG));
		await untilAnAnswerIsHeld(page);

		await expect(trackRow(page, 0)).toHaveText(drawn);

		await release(page);
		await expect(
			page.getByRole("heading", { level: 1, name: NAMES_A_SONG }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toContainText(SONG);
		await expect(trackRow(page, 1)).toHaveCount(0);
		await expectNotSeenWhileHeld(page, "the song's row");
		await expectNotSeenWhileHeld(page, "an empty list");
	});

	for (const { kind, route, drawn } of PAGES) {
		test(`${kind} page opened before its answer shows the loading state, and not within 100 ms`, async ({
			page,
		}) => {
			await warmUp(page);
			await watch(page, {
				name: "the loading state",
				selector: "main",
				text: LOADING,
			});

			await hold(page);
			const openedAt = await open(page, route);
			await untilAnAnswerIsHeld(page);

			await expect(loading(page).first()).toBeVisible();
			const shownAt = await firstSeen(page, "the loading state");
			expect(
				(shownAt as number) - openedAt,
				"the loading state was drawn within 100 ms of opening the page",
			).toBeGreaterThanOrEqual(100);

			await release(page);
			await expect(drawn(page)).toBeVisible();
			await expect(loading(page)).toHaveCount(0);
		});

		test(`${kind} page answered within 100 ms never shows the loading state`, async ({
			page,
		}) => {
			await page.clock.install();
			await warmUp(page);
			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await watch(page, {
				name: "the loading state",
				selector: "main",
				text: LOADING,
			});

			const before = await delivered(page);
			await open(page, route);
			await untilDeliveredPast(page, before);
			await expect(drawn(page)).toBeVisible();

			await runClockFor(page, 500);
			await expect(drawn(page)).toBeVisible();
			expect(await firstSeen(page, "the loading state")).toBeNull();
		});
	}
});

test.describe("Enter pressed before the typed query is answered", () => {
	test.beforeEach(({ page }) => watchTheWorker(page));

	test("acts on what the typed query names once its answer arrives", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(NAMES_A_SONG);
		await expect(options(page).filter({ hasText: SONG })).toHaveCount(1);

		await watch(page, {
			name: "the results page",
			selector: "h1",
			text: NAMES_THE_ARTIST,
			exact: true,
		});
		await hold(page);
		await searchField(page).fill(NAMES_THE_ARTIST);
		await untilAnAnswerIsHeld(page);
		await searchField(page).press("Enter");
		await release(page);

		await expect(
			page.getByRole("heading", { level: 1, name: ARTIST }),
		).toBeVisible();
		expect(await firstSeen(page, "the results page")).toBeNull();
		await expectSettlesAt(player, () => playedFrom(player), null);
	});

	test("never acts on what the cursor rested on in the answer before", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(NAMES_THE_ARTIST);
		await expect(options(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await watch(page, {
			name: "the artist's page",
			selector: "h1",
			text: ARTIST,
			exact: true,
		});
		await hold(page);
		await searchField(page).fill(NAMES_A_SONG);
		await untilAnAnswerIsHeld(page);
		await searchField(page).press("Enter");
		await release(page);

		await expect(
			page.getByRole("heading", { level: 1, name: NAMES_A_SONG }),
		).toBeVisible();
		expect(await firstSeen(page, "the artist's page")).toBeNull();
		await expectSettlesAt(player, () => playedFrom(player), null);
	});
});

const ZERO_COUNT = /(?:^|[^\d.,])0 (?:tracks?|albums?)(?![a-z])/;

const recordZeroCounts = (page: Page) =>
	page.evaluate((pattern) => {
		const zero = new RegExp(pattern);
		const seen: { text: string | null } = { text: null };
		Reflect.set(window, "__zeroCount", seen);
		const look = () => {
			const text = document.querySelector("main header")?.textContent ?? "";
			if (seen.text === null && zero.test(text)) seen.text = text;
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		look();
	}, ZERO_COUNT.source);

const zeroCountSeen = (page: Page) =>
	page.evaluate(
		() => (Reflect.get(window, "__zeroCount") as { text: string | null }).text,
	);

const COUNTED: {
	kind: string;
	route: string;
	counts: string[];
}[] = [
	{
		kind: "an album",
		route: albumRoute(ARTIST, ALBUM),
		counts: ["12 tracks"],
	},
	{
		kind: "a genre",
		route: genreRoute(GENRE),
		counts: ["7 tracks"],
	},
	{
		kind: "an artist",
		route: artistRoute(ARTIST),
		counts: ["1 album", "12 tracks"],
	},
];

test.describe("a page's header before the worker has answered", () => {
	test.beforeEach(({ page }) => watchTheWorker(page));

	for (const { kind, route, counts } of COUNTED) {
		test(`${kind} page counts nothing until its answer arrives, then counts what it holds`, async ({
			page,
		}) => {
			await warmUp(page);
			await recordZeroCounts(page);

			await hold(page);
			await open(page, route);
			await untilAnAnswerIsHeld(page);
			await expect(loading(page).first()).toBeVisible();

			await release(page);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			expect(
				await zeroCountSeen(page),
				"the header counted zero while the answer was held",
			).toBeNull();
		});
	}
});

interface HeaderSeen {
	playDisabled: boolean;
	playMissing: boolean;
	busy: boolean;
	dropped: string | null;
	zeroCount: string | null;
}

const PLAY = en["player.play"];

const recordTheHeader = (
	page: Page,
	{ before = null, kept = [] }: { before?: string | null; kept?: string[] },
) =>
	page.evaluate(
		({ play, zero, before, kept }) => {
			const pattern = new RegExp(zero);
			const seen: HeaderSeen = {
				playDisabled: false,
				playMissing: false,
				busy: false,
				dropped: null,
				zeroCount: null,
			};
			Reflect.set(window, "__headerSeen", seen);
			const look = () => {
				const header = document.querySelector("main header");
				if (!header || header.querySelector("h1")?.textContent === before)
					return;
				const plays = [...header.querySelectorAll("button")].filter(
					(button) => (button.textContent ?? "").trim() === play,
				);
				if (plays.length === 0) seen.playMissing = true;
				for (const button of plays)
					if (
						button.disabled ||
						button.getAttribute("aria-disabled") === "true"
					)
						seen.playDisabled = true;
				if (
					header.matches('[aria-busy="true"]') ||
					header.querySelector('[aria-busy="true"]')
				)
					seen.busy = true;
				const text = header.textContent ?? "";
				const gone = kept.find((one) => !new RegExp(one).test(text));
				if (seen.dropped === null && gone !== undefined) seen.dropped = gone;
				if (seen.zeroCount === null && pattern.test(text))
					seen.zeroCount = text;
			};
			new MutationObserver(look).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
				attributes: true,
				attributeFilter: ["disabled", "aria-disabled", "aria-busy"],
			});
		},
		{ play: PLAY, zero: ZERO_COUNT.source, before, kept },
	);

const headerSeen = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__headerSeen") as HeaderSeen);

const CHANGES = "/api/library/changes";

const untilTheWorkerIsQuiet = async (page: Page) => {
	let seen = -1;
	await expect
		.poll(
			async () => {
				const now = await delivered(page);
				const isQuiet = now === seen;
				seen = now;
				return isQuiet;
			},
			{ message: "Jean's search worker went on answering", intervals: [250] },
		)
		.toBe(true);
};

const UNDER_THE_PATIENCE_MS = 40;

const runClockUntil = async (
	page: Page,
	isDone: () => boolean,
	message: string,
) => {
	for (let step = 0; step < 250 && !isDone(); step += 1)
		await page.clock.runFor(UNDER_THE_PATIENCE_MS);
	expect(isDone(), message).toBe(true);
};

const playInHeader = (page: Page) =>
	viewHeader(page).getByRole("button", { name: PLAY, exact: true });

const expectNothingWaitedFor = (seen: HeaderSeen) => {
	expect(
		seen.playDisabled,
		"Play was disabled before the patience ran out",
	).toBe(false);
	expect(seen.playMissing, "Play was missing before the patience ran out").toBe(
		false,
	);
	expect(
		seen.zeroCount,
		"the header counted zero before the patience ran out",
	).toBeNull();
	expect(
		seen.dropped,
		"the header stood a stat down before the patience ran out",
	).toBeNull();
	expect(
		seen.busy,
		"the header said it was loading before the patience ran out",
	).toBe(false);
};

test.describe("a page's header answered within 100 ms", () => {
	test.beforeEach(({ page }) => watchTheWorker(page));

	for (const { kind, route, counts } of COUNTED) {
		test(`${kind} page never disables Play or stands its stats down before the patience`, async ({
			page,
		}) => {
			await page.clock.install();
			await warmUp(page);
			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await recordTheHeader(page, { before: WARMED_UP });

			const before = await delivered(page);
			await open(page, route);
			await untilDeliveredPast(page, before);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			await expect(playInHeader(page)).toBeEnabled();

			expectNothingWaitedFor(await headerSeen(page));
		});

		test(`${kind} page held past the patience waits in its header until its answer arrives`, async ({
			page,
		}) => {
			await warmUp(page);

			await hold(page);
			await open(page, route);
			await untilAnAnswerIsHeld(page);
			await expect(loading(page).first()).toBeVisible();

			await expect(
				viewHeader(page).locator('[aria-busy="true"]').first(),
			).toBeAttached();
			const pressable = await playInHeader(page).evaluateAll(
				(buttons) =>
					buttons.filter(
						(button) =>
							!(button as HTMLButtonElement).disabled &&
							button.getAttribute("aria-disabled") !== "true",
					).length,
			);
			expect(pressable, "Play could be pressed while the answer was held").toBe(
				0,
			);

			await release(page);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			await expect(playInHeader(page)).toBeEnabled();
		});
	}

	for (const { kind, route, counts } of COUNTED.filter(
		({ route }) => route !== artistRoute(ARTIST),
	)) {
		test(`${kind} page asked again after the library changed keeps its stats and Play under the patience`, async ({
			page,
			player,
		}) => {
			await page.clock.install();
			await warmUp(page);
			const before = await delivered(page);
			await open(page, route);
			await untilDeliveredPast(page, before);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			await expect(playInHeader(page)).toBeEnabled();

			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await recordTheHeader(page, {
				kept: counts.map((count) => count.replace(/^\d+/, "\\d+")),
			});
			const asked = await delivered(page);
			const changesBefore = requestsTo(player, CHANGES).length;
			const added = await page.request.post("/__control/library", {
				data: { add: 1 },
			});
			expect(added.ok(), "the fake adds a track").toBe(true);
			await runClockUntil(
				page,
				() => requestsTo(player, CHANGES).length > changesBefore,
				"Jean never asked for the change",
			);
			await untilDeliveredPast(page, asked);
			await untilTheWorkerIsQuiet(page);

			await expect(viewHeader(page)).toContainText(/\d+ tracks?\b/);
			await expect(playInHeader(page)).toBeEnabled();
			expectNothingWaitedFor(await headerSeen(page));
		});
	}
});
