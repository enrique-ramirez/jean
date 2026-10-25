import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	guidOfPlaylist,
	holdRequests,
	openAllMusic,
	test,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";

// Every state a library view can be in before, or instead of, the rows it draws: the component not
// answering, discovery not back yet, a build under way, and a read of rows that failed. Only the
// first has anything to say. The one thing none of them may say is that the library is empty,
// because the user's library is not.

const ARTIST = "Babasónicos";
const QUERY = "Babas";

const fill = (phrase: string, values: Record<string, string>) =>
	phrase.replace(/\{(\w+)\}/g, (_, name: string) => values[name]);

const patternOf = (phrase: string) =>
	phrase.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+?");

interface LibraryView {
	name: string;
	path: string;
	heading: string | RegExp;
	reading: string | RegExp;
}

const VIEWS: LibraryView[] = [
	{
		name: "All music",
		path: "/#/all",
		heading: en["library.allMusic"],
		reading: en["library.reading"],
	},
	{
		name: "home",
		path: "/",
		// "Your library" until there is a duration to lead with, "… of music" after.
		heading: new RegExp(`${en["home.yourLibrary"]}|${en["home.ofMusic"]}`),
		reading: en["home.reading"],
	},
	{
		name: "the genres index",
		path: "/#/genres",
		heading: en["home.genres"],
		reading: en["library.reading"],
	},
	{
		name: "an artist",
		path: `/#/artist/${encodeURIComponent(ARTIST)}`,
		heading: ARTIST,
		reading: en["library.reading"],
	},
	{
		name: "search results",
		path: `/#/search/${encodeURIComponent(QUERY)}`,
		heading: QUERY,
		// The plain phrase until a total is known, then the count of what it has
		// searched so far.
		reading: new RegExp(
			`${patternOf(en["library.reading"])}|${patternOf(en["search.reading"])}`,
		),
	},
];

const [ALL_MUSIC] = VIEWS;

const main = (page: Page) => page.locator("main");

const headingOf = (page: Page, view: LibraryView) =>
	main(page).getByRole("heading", {
		level: 1,
		name: view.heading,
		exact: typeof view.heading === "string",
	});

const EMPTY_NOTICES = [
	en["library.empty"],
	en["library.noGenre"],
	en["library.noAlbum"],
	en["library.noArtist"],
	en["home.nothingYet"],
	en["genre.noTags"],
	en["artist.nothingBy"],
].map(patternOf);

// Every match of `patterns` the page has put on screen since it started
// loading. An empty notice drawn for one render and replaced on the next is
// exactly the defect, and a read taken off the screen afterwards cannot see it.
const recordFromLoad = (page: Page, patterns: string[]) =>
	page.addInitScript((sources: string[]) => {
		const drawn: string[] = [];
		Reflect.set(window, "__drawn", drawn);
		const wanted = sources.map((source) => new RegExp(source));
		const look = () => {
			const text = document.body?.textContent ?? "";
			for (const pattern of wanted) {
				const found = text.match(pattern)?.[0];
				if (found && !drawn.includes(found)) drawn.push(found);
			}
		};
		// The document rather than its root element: a browser runs an init
		// script before the parser has made one.
		new MutationObserver(look).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}, patterns);

const drawnSinceLoad = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__drawn") as string[]);

const statePolls = (player: FakePlayer) =>
	player.requests.filter((entry) => entry.path.startsWith("/api/state")).length;

// One read, not a retrying one: the notice is already up, so anything of the
// view still on screen now was drawn beside it.
const expectNothingOfTheView = async (page: Page, view: LibraryView) => {
	const text = (await main(page).textContent()) ?? "";
	const counts = {
		heading: await headingOf(page, view).count(),
		rows: await main(page).locator('[role="row"]').count(),
		shelves: await main(page)
			.getByRole("navigation", { name: "Shelves" })
			.count(),
		genres: await main(page)
			.getByRole("link", { name: /tracks?$/ })
			.count(),
		emptyNotices: EMPTY_NOTICES.filter((pattern) =>
			new RegExp(pattern).test(text),
		).length,
	};
	expect(counts).toEqual({
		heading: 0,
		rows: 0,
		shelves: 0,
		genres: 0,
		emptyNotices: 0,
	});
};

const tryAgain = (page: Page) =>
	main(page).getByRole("button", { name: en["action.tryAgain"] });

const checkAgain = (page: Page) =>
	main(page).getByRole("button", { name: en["fooJean.checkAgain"] });

test.describe("foo_jean not answering", () => {
	test.use({ fooJean: { reachable: false } });

	for (const view of VIEWS) {
		test(`${view.name} says so, says what to check, and offers to check again, in place of its header and content`, async ({
			page,
		}) => {
			await page.goto(view.path);

			await expect(
				main(page).getByText(en["fooJean.unreachable.summary"]),
			).toBeVisible();
			await expect(
				main(page).getByText(en["fooJean.unreachable.fix"]),
			).toBeVisible();
			await expect(checkAgain(page)).toBeVisible();
			expect(await tryAgain(page).count()).toBe(0);
			await expectNothingOfTheView(page, view);
		});
	}
});

test.describe("before discovery answers", () => {
	for (const view of VIEWS) {
		test(`${view.name} draws its header and the reading notice, and never an empty one`, async ({
			page,
			player,
		}) => {
			await recordFromLoad(page, EMPTY_NOTICES);
			player.fooJean.hangCapabilities = true;
			await page.goto(view.path);

			await expect(headingOf(page, view)).toBeVisible();
			await expect(main(page).getByText(view.reading)).toBeVisible();
			expect(await drawnSinceLoad(page)).toEqual([]);
		});
	}
});

test.describe("foo_jean not answering, and asked again", () => {
	test.use({ fooJean: { reachable: false } });

	test("Check again asks for the capabilities at once, and the backoff starts over", async ({
		page,
	}) => {
		const asked: number[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === "/api/capabilities")
				asked.push(Date.now());
		});

		await page.goto(ALL_MUSIC.path);
		await expect(checkAgain(page)).toBeVisible();

		// Discovery retries on its own from 500 ms, doubling. Pressed straight
		// after the third ask, the next automatic one is four seconds away, so an
		// ask inside a second can only be the button's.
		await expect.poll(() => asked.length, { intervals: [50] }).toBe(3);
		// Read before the press: the ask can land before `click()` resolves.
		const pressed = Date.now();
		await checkAgain(page).click();

		await expect
			.poll(() => asked.length, { intervals: [50], timeout: 2_000 })
			.toBeGreaterThanOrEqual(4);
		expect(asked[3] - pressed).toBeLessThan(1_000);

		// Without the reset the next automatic ask is eight seconds out; from
		// `MIN_RETRY_MS` it is one.
		await expect
			.poll(() => asked.length, { intervals: [50], timeout: 4_000 })
			.toBeGreaterThanOrEqual(5);
		expect(asked[4] - asked[3]).toBeLessThan(2_500);
	});
});

// The window a freshly started player sits in. Discovery lands, the first
// library ask starts a build and answers `202`, and the snapshot never comes:
// every one of those steps is a render where the library is not known to be
// empty.
test.describe("a library still building its first snapshot", () => {
	test.use({ fooJean: { libraryReady: false } });

	for (const view of VIEWS) {
		test(`${view.name} never says the library is empty, from load to the build under way`, async ({
			page,
			player,
		}) => {
			await recordFromLoad(page, EMPTY_NOTICES);
			await page.goto(view.path);

			await expect(headingOf(page, view)).toBeVisible();
			await expect.poll(() => statePolls(player)).toBeGreaterThanOrEqual(3);

			expect(await drawnSinceLoad(page)).toEqual([]);
		});
	}
});

// What a view may say while rows are slow to come, and none of it is said for rows alone: a
// pending row is its own answer, and an unreachable player has a notice of its own above.
const SAID_OF_ROWS = [
	en["library.readFailed"],
	en["library.readUnavailable"],
	en["library.readUnreachable"],
	en["library.readTimedOut"],
	en["library.halted.summary"],
	en["action.tryAgain"],
	en["fooJean.unreachable.summary"],
].map(patternOf);

interface RowsAsk {
	sentAt: number;
	answeredAt: number | null;
	status: number | "dropped" | null;
}

interface RowsWatch {
	asks: RowsAsk[];
	busyAt: number | null;
	landedAt: number | null;
}

declare global {
	interface Window {
		__rows: RowsWatch;
	}
}

const watchTheRows = (page: Page) =>
	page.addInitScript(() => {
		const watch: RowsWatch = { asks: [], busyAt: null, landedAt: null };
		window.__rows = watch;
		const send = window.fetch;
		window.fetch = async (input, init) => {
			const url = new URL(
				input instanceof Request ? input.url : String(input),
				location.href,
			);
			if (url.pathname !== "/api/library/rows") return send(input, init);
			const ask: RowsAsk = {
				sentAt: performance.now(),
				answeredAt: null,
				status: null,
			};
			watch.asks.push(ask);
			try {
				const answer = await send(input, init);
				ask.status = answer.status;
				return answer;
			} catch (error) {
				ask.status = "dropped";
				throw error;
			} finally {
				ask.answeredAt = performance.now();
			}
		};
		new MutationObserver(() => {
			const row = document.querySelector('[role="row"][data-row="0"]');
			if (!row) return;
			if (row.getAttribute("aria-busy") === "true")
				watch.busyAt ??= performance.now();
			else if (watch.busyAt !== null) watch.landedAt ??= performance.now();
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["aria-busy"],
		});
	});

const rowsWatched = (page: Page) => page.evaluate(() => window.__rows);

const RETRY_FIRST_MS = 5_000;
const POLL_TICK_MS = 1_000;
// Room for a loaded machine between a wait running out and the request it releases.
const SLACK_MS = 1_500;
// `performance.now()` is coarsened by the browser, and a timer may fire a hair early.
const EARLY_MS = 50;

// The fake answers the first ask on a fresh player with a declaration rather than rows, so the
// player is declared first and the case starts from a reload, where the window is the first ask.
const reloadWithRowsFailing = async (
	page: Page,
	player: FakePlayer,
	failRows: { status: 429 | 500 | 503 | "drop"; times: number },
) => {
	await openAllMusic(page);
	await untilQuiet(player);
	await watchTheRows(page);
	await recordFromLoad(page, SAID_OF_ROWS);
	player.fooJean.failRows = failRows;
	await page.reload();
};

const firstRefusal = async (page: Page, refused: RowsAsk["status"]) => {
	await expect
		.poll(
			async () =>
				(await rowsWatched(page)).asks.findIndex(
					(ask) => ask.status === refused && ask.answeredAt !== null,
				),
			{ message: `no rows request was answered ${refused}` },
		)
		.toBeGreaterThanOrEqual(0);
	const { asks } = await rowsWatched(page);
	const first = asks.find((ask) => ask.status === refused) as RowsAsk;
	return { refusedAt: first.answeredAt as number };
};

const landedAt = async (page: Page) => {
	await expect(trackRow(page, 0)).not.toHaveAttribute("aria-busy", "true", {
		timeout: RETRY_FIRST_MS + POLL_TICK_MS + SLACK_MS * 2,
	});
	const watched = await rowsWatched(page);
	expect(watched.busyAt, "row 0 was never drawn pending").not.toBeNull();
	return watched.landedAt as number;
};

for (const status of [500, 503] as const)
	test.describe(`a window answered ${status} once`, () => {
		test("stays pending and says nothing until the first poll five seconds after, and then lands", async ({
			page,
			player,
		}) => {
			await reloadWithRowsFailing(page, player, { status, times: 1 });
			const { refusedAt } = await firstRefusal(page, status);

			const waited = (await landedAt(page)) - refusedAt;
			expect(waited).toBeGreaterThanOrEqual(RETRY_FIRST_MS - EARLY_MS);
			expect(waited).toBeLessThanOrEqual(
				RETRY_FIRST_MS + POLL_TICK_MS + SLACK_MS,
			);
			expect(await drawnSinceLoad(page)).toEqual([]);
		});
	});

test.describe("a window refused 429 once", () => {
	test("lands once the Retry-After has passed, without the five seconds a failure waits", async ({
		page,
		player,
	}) => {
		const RETRY_AFTER_MS = 1_000;

		await reloadWithRowsFailing(page, player, { status: 429, times: 1 });
		const { refusedAt } = await firstRefusal(page, 429);

		const waited = (await landedAt(page)) - refusedAt;
		expect(waited).toBeGreaterThanOrEqual(RETRY_AFTER_MS - EARLY_MS);
		expect(waited).toBeLessThan(RETRY_FIRST_MS - EARLY_MS);
		expect(await drawnSinceLoad(page)).toEqual([]);
	});
});

const BESIDE_THE_FIRST_MS = 500;

// Chromium sends a request again by itself on a fresh connection when a reused one is dropped, so
// the fake drops every rows request rather than one, and the page sees each ask fail.
test.describe("a player that drops every rows request", () => {
	test("leaves the rows pending and says nothing, and asks nothing more until five seconds have passed", async ({
		page,
		player,
	}) => {
		await reloadWithRowsFailing(page, player, {
			status: "drop",
			times: 1_000,
		});
		const { refusedAt } = await firstRefusal(page, "dropped");

		const sentAfter = async (from: number) =>
			(await rowsWatched(page)).asks
				.map((ask) => ask.sentAt - refusedAt)
				.filter((after) => after > from);
		await expect
			.poll(async () => (await sentAfter(RETRY_FIRST_MS - EARLY_MS)).length, {
				message: "the dropped rows were never asked for again",
				timeout: RETRY_FIRST_MS + POLL_TICK_MS + SLACK_MS * 2,
			})
			.toBeGreaterThan(0);
		expect(
			(await sentAfter(BESIDE_THE_FIRST_MS)).filter(
				(after) => after < RETRY_FIRST_MS - EARLY_MS,
			),
			"rows were asked for again inside the wait",
		).toEqual([]);

		await expect(trackRow(page, 0)).toHaveAttribute("aria-busy", "true");
		expect(
			(await rowsWatched(page)).landedAt,
			"row 0 drew a track nobody answered",
		).toBeNull();
		expect(await drawnSinceLoad(page)).toEqual([]);
	});
});

// The declaration names the structure the poll last announced, and foo_jean answers it 409 where
// tracks were added since, as foobar2000 does while it imports a folder in batches.
const isTheDeclaration = (request: {
	method: () => string;
	url: () => string;
	postDataJSON: () => unknown;
}) => {
	if (request.method() !== "POST") return false;
	if (new URL(request.url()).pathname !== "/api/library/rows") return false;
	const runs = (request.postDataJSON() as { runs?: unknown[] } | null)?.runs;
	return Array.isArray(runs) && runs.length === 0;
};

const declaredStructures = (page: Page) => {
	const structures: string[] = [];
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/library/rows"
		)
			structures.push(
				String((request.postDataJSON() as { structure: unknown }).structure),
			);
	});
	return structures;
};

test.describe("a declaration answered 409 because tracks were added meanwhile", () => {
	test("is declared again at the structure the poll announces, says nothing, and All Music draws its rows", async ({
		page,
		player,
	}) => {
		await recordFromLoad(page, [
			...SAID_OF_ROWS,
			patternOf(en["library.readRefused"]),
			"tracks were added or removed",
		]);
		const declaration = await holdRequests(page, isTheDeclaration, {
			count: 1,
		});
		const declared = declaredStructures(page);
		await page.goto("/#/all");
		await declaration.untilHeld();

		player.libraryFeed.columns = [...TRACK_EXPRESSIONS];
		player.libraryFeed.building = [...TRACK_EXPRESSIONS];
		player.finishLibraryBuild();
		const before = String(player.libraryFeed.structure);

		const added = await page.request.post("/__control/library", {
			data: { add: 1 },
		});
		expect(added.ok(), "the fake adds a file to the library").toBe(true);
		await expect
			.poll(() => String(player.libraryFeed.structure), {
				message: "the fake never finished the build the added file started",
			})
			.not.toBe(before);
		const moved = String(player.libraryFeed.structure);

		declaration.release();
		await expect
			.poll(() => declared.filter((structure) => structure === moved).length, {
				message:
					"Jean never declared again at the structure the poll announced",
				timeout: POLL_TICK_MS + SLACK_MS * 2,
			})
			.toBeGreaterThan(0);

		await expect(trackRow(page, 0)).not.toHaveAttribute("aria-busy", "true");
		await expect(trackRow(page, 0)).toBeVisible();
		await untilQuiet(player);
		expect(await drawnSinceLoad(page)).toEqual([]);
	});
});

// One answer per install. A view working out which columns resolve from the
// rows it holds would offer Year on a playlist, whose rows carry one, and
// withhold it on a shelf that has no rows yet.
test.describe("columns before the first snapshot", () => {
	test.use({
		fooJean: { libraryReady: false },
		settings: {
			"jean.fieldAvailability": TRACK_EXPRESSIONS.filter(
				(expression) => expression !== "%year%",
			),
			"jean.columns": ["duration", "rating", "playCount", "year"],
		},
	});

	const offered = async (page: Page) => {
		await page.getByRole("button", { name: en["columns.viewOptions"] }).click();
		const items = page.getByRole("menuitemcheckbox");
		await expect(items.first()).toBeVisible();
		const read = await items.evaluateAll((elements) =>
			elements.map((element) => ({
				name: element.textContent?.trim(),
				checked: element.getAttribute("aria-checked"),
				disabled:
					(element as HTMLButtonElement).disabled ||
					element.getAttribute("aria-disabled") === "true",
			})),
		);
		await page.keyboard.press("Escape");
		return read;
	};

	const YEAR_UNAVAILABLE = fill(en["columns.unavailable"], {
		column: en["column.year"],
	});

	test("a playlist opened first draws no Year, as this browser last heard", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the compact viewport never draws a Year column");

		await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
		// Los Calientes: 4:37 long, on a record from 2001.
		await expect(trackRow(page, 0)).toContainText("4:37");
		expect(await trackRow(page, 0).textContent()).not.toContain("2001");
	});

	test("a playlist opened first and a shelf opened first offer the same columns", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
		await expect(trackRow(page, 0)).toBeAttached();
		const onPlaylist = await offered(page);

		await page.goto("/#/shelf/recent");
		await page.reload();
		await expect(
			page.getByRole("button", { name: en["columns.viewOptions"] }),
		).toBeVisible();
		const onShelf = await offered(page);

		expect(onPlaylist.map((item) => item.name)).toContain(YEAR_UNAVAILABLE);
		expect(onShelf).toEqual(onPlaylist);
	});
});
