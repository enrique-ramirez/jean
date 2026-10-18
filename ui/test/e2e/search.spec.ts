import { LATE_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
} from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	modesSent,
	openLibrary,
	playedFrom,
	playRequests,
	requestsTo,
	revealSearch,
	runClockFor,
	scratchOf,
	searchField,
	searchFor,
	test,
	trackPlayed,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";

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
	markReleased: () => void;
	releasedAt: () => number | null;
	watch: (watch: Watch) => void;
	firstSeen: (name: string) => number | null;
	open: (hash: string) => number;
}

declare global {
	interface Window {
		__pageHarness: Harness;
	}
}

const watchThePage = (page: Page) =>
	page.addInitScript(() => {
		let releasedAt: number | null = null;
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

		window.__pageHarness = {
			markReleased: () => {
				releasedAt = performance.now();
			},
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

const watch = (page: Page, what: Watch) =>
	page.evaluate((one) => window.__pageHarness.watch(one), what);
const firstSeen = (page: Page, name: string) =>
	page.evaluate((one) => window.__pageHarness.firstSeen(one), name);
const releasedAt = (page: Page) =>
	page.evaluate(() => window.__pageHarness.releasedAt());
const open = (page: Page, route: string) =>
	page.evaluate((hash) => window.__pageHarness.open(hash), `#/${route}`);

const searchesFor = (player: FakePlayer, query: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === "/api/library/search" &&
			new URL(entry.path, "http://fake.invalid").searchParams.get("query") ===
				query,
	).length;

const untilSearchedFor = (player: FakePlayer, query: string) =>
	expect
		.poll(() => searchesFor(player, query), {
			message: `Jean never asked foo_jean to search for ${query}`,
		})
		.toBeGreaterThan(0);

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

const warmUp = async (page: Page, player: FakePlayer) => {
	const whole = page.waitForResponse(isLatePart);
	await openLibrary(page);
	await whole;
	const before = questionsTo(player, WARM_UP);
	await open(page, WARM_UP);
	await expect(
		page.getByRole("heading", { name: en["artist.discography"] }),
	).toBeVisible();
	await untilAskedPast(player, WARM_UP, before);
	await untilQuiet(player);
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

const questionOf = (route: string) => route.slice(0, route.indexOf("/"));

const questionsTo = (player: FakePlayer, route: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === `/api/library/${questionOf(route)}`,
	).length;

const holdQuestions = async (page: Page) => {
	const held = await page.request.post("/__control/holdQuestions", {
		data: { hold: true },
	});
	expect(held.ok(), "the fake holds questions on request").toBe(true);
};

const releaseQuestions = async (page: Page) => {
	await page.evaluate(() => window.__pageHarness.markReleased());
	const released = await page.request.post("/__control/holdQuestions", {
		data: {},
	});
	expect(released.ok(), "the fake answers every question it held").toBe(true);
};

const untilAskedPast = (player: FakePlayer, route: string, before: number) =>
	expect
		.poll(() => questionsTo(player, route), {
			message: `Jean never asked foo_jean for the ${questionOf(route)}`,
		})
		.toBeGreaterThan(before);

const isLatePart = (response: { url: () => string; ok: () => boolean }) => {
	const url = new URL(response.url());
	return (
		url.pathname === "/api/library/export" &&
		url.searchParams
			.getAll("only")
			.some((column) => LATE_EXPRESSIONS.includes(column)) &&
		response.ok()
	);
};

test.describe("while foo_jean has not answered a search", () => {
	test.beforeEach(({ page }) => watchThePage(page));

	test("the suggestions already drawn stay until the typed query's own arrive", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(NAMES_THE_ARTIST);
		await expect(options(page).first()).toContainText(ARTIST);

		await watch(page, {
			name: "the song's suggestion",
			selector: '[role="option"]',
			text: SONG,
		});
		await holdQuestions(page);
		await searchField(page).fill(NAMES_A_SONG);
		await untilSearchedFor(player, NAMES_A_SONG);

		await expect(options(page).first()).toContainText(ARTIST);

		await releaseQuestions(page);
		await expect(options(page).filter({ hasText: SONG })).toHaveCount(1);
		await expect(options(page).filter({ hasText: ARTIST })).toHaveCount(0);
		await expectNotSeenWhileHeld(page, "the song's suggestion");
	});

	test("the results page keeps the rows it drew until the new query's arrive", async ({
		page,
		player,
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
		await holdQuestions(page);
		await open(page, searchRoute(NAMES_A_SONG));
		await untilSearchedFor(player, NAMES_A_SONG);

		await expect(trackRow(page, 0)).toHaveText(drawn);

		await releaseQuestions(page);
		await expect(
			page.getByRole("heading", { level: 1, name: NAMES_A_SONG }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toContainText(SONG);
		await expect(trackRow(page, 1)).toHaveCount(0);
		await expectNotSeenWhileHeld(page, "the song's row");
		await expectNotSeenWhileHeld(page, "an empty list");
	});
});

test.describe("while foo_jean has not answered a page's question", () => {
	test.beforeEach(({ page }) => watchThePage(page));

	for (const { kind, route, drawn } of PAGES) {
		test(`${kind} page opened before its answer shows the loading state, and not within 100 ms`, async ({
			page,
			player,
		}) => {
			await warmUp(page, player);
			await watch(page, {
				name: "the loading state",
				selector: "main",
				text: LOADING,
			});

			await holdQuestions(page);
			const before = questionsTo(player, route);
			const openedAt = await open(page, route);
			await untilAskedPast(player, route, before);

			await expect(loading(page).first()).toBeVisible();
			const shownAt = await firstSeen(page, "the loading state");
			expect(
				(shownAt as number) - openedAt,
				"the loading state was drawn within 100 ms of opening the page",
			).toBeGreaterThanOrEqual(100);

			await releaseQuestions(page);
			await expect(drawn(page)).toBeVisible();
			await expect(loading(page)).toHaveCount(0);
		});

		test(`${kind} page answered within 100 ms never shows the loading state`, async ({
			page,
			player,
		}) => {
			await page.clock.install();
			await warmUp(page, player);
			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await watch(page, {
				name: "the loading state",
				selector: "main",
				text: LOADING,
			});

			const before = questionsTo(player, route);
			await open(page, route);
			await untilAskedPast(player, route, before);
			await expect(drawn(page)).toBeVisible();

			await runClockFor(page, 500);
			await expect(drawn(page)).toBeVisible();
			expect(await firstSeen(page, "the loading state")).toBeNull();
		});
	}
});

test.describe("Enter pressed before the typed query is answered", () => {
	test.beforeEach(({ page }) => watchThePage(page));

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
		await holdQuestions(page);
		await searchField(page).fill(NAMES_THE_ARTIST);
		await untilSearchedFor(player, NAMES_THE_ARTIST);
		await searchField(page).press("Enter");
		await releaseQuestions(page);

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
		await holdQuestions(page);
		await searchField(page).fill(NAMES_A_SONG);
		await untilSearchedFor(player, NAMES_A_SONG);
		await searchField(page).press("Enter");
		await releaseQuestions(page);

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

test.describe("a page's header before foo_jean has answered", () => {
	test.beforeEach(({ page }) => watchThePage(page));

	for (const { kind, route, counts } of COUNTED) {
		test(`${kind} page counts nothing until its answer arrives, then counts what it holds`, async ({
			page,
			player,
		}) => {
			await warmUp(page, player);
			await recordZeroCounts(page);

			await holdQuestions(page);
			const before = questionsTo(player, route);
			await open(page, route);
			await untilAskedPast(player, route, before);
			await expect(loading(page).first()).toBeVisible();

			await releaseQuestions(page);
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

const shuffleInHeader = (page: Page) =>
	viewHeader(page).getByRole("button", {
		name: en["player.shuffle"],
		exact: true,
	});

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
	test.beforeEach(({ page }) => watchThePage(page));

	for (const { kind, route, counts } of COUNTED) {
		test(`${kind} page never disables Play or stands its stats down before the patience`, async ({
			page,
			player,
		}) => {
			await page.clock.install();
			await warmUp(page, player);
			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await recordTheHeader(page, { before: WARMED_UP });

			const before = questionsTo(player, route);
			await open(page, route);
			await untilAskedPast(player, route, before);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			await expect(playInHeader(page)).toBeEnabled();

			expectNothingWaitedFor(await headerSeen(page));
		});

		test(`${kind} page held past the patience waits in its header until its answer arrives`, async ({
			page,
			player,
		}) => {
			await warmUp(page, player);

			await holdQuestions(page);
			const before = questionsTo(player, route);
			await open(page, route);
			await untilAskedPast(player, route, before);
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

			await releaseQuestions(page);
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
			await warmUp(page, player);
			const before = questionsTo(player, route);
			await open(page, route);
			await untilAskedPast(player, route, before);
			for (const count of counts)
				await expect(viewHeader(page)).toContainText(count);
			await expect(playInHeader(page)).toBeEnabled();

			await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
			await recordTheHeader(page, {
				kept: counts.map((count) => count.replace(/^\d+/, "\\d+")),
			});
			const asked = questionsTo(player, route);
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
			await untilAskedPast(player, route, asked);
			await untilQuiet(player);

			await expect(viewHeader(page)).toContainText(/\d+ tracks?\b/);
			await expect(playInHeader(page)).toBeEnabled();
			expectNothingWaitedFor(await headerSeen(page));
		});
	}
});

const PLAYED: {
	kind: string;
	route: string;
	heading: string;
	first: string;
	tracks: number;
}[] = [
	{
		kind: "an album",
		route: albumRoute(ARTIST, ALBUM),
		heading: ALBUM,
		first: "Los Calientes",
		tracks: 12,
	},
	{
		kind: "a genre",
		route: genreRoute(GENRE),
		heading: GENRE,
		first: "Rotten Apple",
		tracks: 7,
	},
	{
		kind: "an artist",
		route: artistRoute(ARTIST),
		heading: ARTIST,
		first: "Los Calientes",
		tracks: 12,
	},
];

test.describe("the Play and Shuffle shortcuts pressed before a page's answer", () => {
	test.beforeEach(({ page }) => watchThePage(page));
	test.skip(({ isMobile }) => isMobile, "p and s are keyboard shortcuts");

	const holdThePage = async (
		page: Page,
		player: FakePlayer,
		route: string,
		heading: string,
	) => {
		await holdQuestions(page);
		const before = questionsTo(player, route);
		await open(page, route);
		await untilAskedPast(player, route, before);
		await expect(
			page.getByRole("heading", { level: 1, name: heading }),
		).toBeVisible();
	};

	const underThePatience = async (page: Page, player: FakePlayer) => {
		await page.clock.install();
		await warmUp(page, player);
		await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
	};

	for (const { kind, route, heading, first, tracks } of PLAYED) {
		test(`p on ${kind} page under the patience plays the page once its answer arrives, as the Play button does`, async ({
			page,
			player,
		}) => {
			await underThePatience(page, player);
			await holdThePage(page, player, route, heading);
			await expect(playInHeader(page)).toBeEnabled();
			await page.keyboard.press("p");

			await releaseQuestions(page);
			await expect
				.poll(() => trackPlayed(player), {
					message: "the shortcut pressed before the answer played nothing",
				})
				.toBe(first);
			expect(playedFrom(player)).toEqual({
				id: scratchOf(player)?.guid,
				index: 0,
			});
			expect(scratchOf(player)?.items).toHaveLength(tracks);
			await expectSettlesAt(player, () => playRequests(player).length, 1);
		});

		test(`s on ${kind} page under the patience shuffles the page once its answer arrives, as the Shuffle button does`, async ({
			page,
			player,
		}) => {
			await underThePatience(page, player);
			await holdThePage(page, player, route, heading);
			await expect(shuffleInHeader(page)).toBeEnabled();
			await page.keyboard.press("s");

			await releaseQuestions(page);
			await expect
				.poll(() => trackPlayed(player), {
					message: "the shortcut pressed before the answer played nothing",
				})
				.not.toBeNull();
			const scratch = scratchOf(player);
			expect(playedFrom(player)?.id).toBe(scratch?.guid);
			expect(scratch?.items).toHaveLength(tracks);
			expect(scratch?.items.map((track) => track["%title%"])).toContain(first);
			await expectSettlesAt(
				player,
				() => ({
					plays: playRequests(player).length,
					modes: modesSent(player),
				}),
				{ plays: 1, modes: ["shuffleTracks"] },
			);
		});

		test(`p and s on ${kind} page past the patience, its buttons disabled, do nothing when its answer arrives`, async ({
			page,
			player,
		}) => {
			await warmUp(page, player);
			await holdThePage(page, player, route, heading);
			await expect(loading(page).first()).toBeVisible();
			await expect(playInHeader(page)).toBeDisabled();
			await page.keyboard.press("p");
			await page.keyboard.press("s");

			await releaseQuestions(page);
			await expect(playInHeader(page)).toBeEnabled();
			await expectSettlesAt(
				player,
				() => ({
					plays: playRequests(player).length,
					modes: modesSent(player),
				}),
				{ plays: 0, modes: [] },
			);
		});
	}
});

const SUGGESTED: {
	kind: string;
	query: string;
	suggestion: RegExp;
	heading: string;
}[] = [
	{
		kind: "an artist",
		query: NAMES_THE_ARTIST,
		suggestion: new RegExp(`^${ARTIST}`),
		heading: ARTIST,
	},
	{
		kind: "an album",
		query: "jessico",
		suggestion: new RegExp(`^${ALBUM}`),
		heading: ALBUM,
	},
	{
		kind: "a genre",
		query: "grunge",
		suggestion: new RegExp(`^${GENRE}`),
		heading: GENRE,
	},
];

test.describe("a suggestion chosen from an answer the typing has moved past", () => {
	test.beforeEach(({ page }) => watchThePage(page));

	for (const { kind, query, suggestion, heading } of SUGGESTED)
		test(`${kind} opens its page and leaves the query it answered in the field`, async ({
			page,
			player,
		}) => {
			await openWithSearch(page);
			await searchField(page).fill(query);
			const chosen = options(page).filter({ hasText: suggestion });
			await expect(chosen).toHaveCount(1);

			await holdQuestions(page);
			await searchField(page).fill(`${query} z`);
			await untilSearchedFor(player, `${query} z`);
			await chosen.click();
			await releaseQuestions(page);

			await expect(
				page.getByRole("heading", { level: 1, name: heading }),
			).toBeVisible();
			await expect(searchField(page)).toHaveValue(query);
			await untilQuiet(player);
			expect(await searchField(page).inputValue()).toBe(query);
		});
});
