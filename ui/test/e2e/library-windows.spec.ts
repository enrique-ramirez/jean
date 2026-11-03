import type { Route } from "@playwright/test";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	askOf,
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	HEADER_TILES_AT_MOST,
	openAllMusic,
	openSidebar,
	playedFrom,
	revealSearch,
	routeOf,
	scratchOf,
	searchField,
	sidebar,
	statusBar,
	test,
	titleOfPlaylist,
	trackPlayed,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import { dragFrom } from "./gestures.ts";
import { openRowMenu } from "./menus.ts";
import {
	expectRowLanded,
	expectRowPending,
	expectTileAsksAtMost,
	fromTheSecondWindow,
	holdPlaylistPages,
	LONG_PLAYLIST,
	LONG_PLAYLIST_ROWS,
	pageAsks,
	playlistAsksOf,
	playsOf,
	recordRunsAnswers,
	scrollToRow,
	titleIn,
} from "./playlistPages.ts";
import { isRowOnScreen } from "./scrolling.ts";

const WINDOW_ROWS = 2048;

const RUNS = "GET /api/library/runs";
const ROWS = "POST /api/library/rows";
const SUMMARY = "GET /api/library/summary";

type Body = FakePlayer["requests"][number]["body"];

const libraryAsks = (player: FakePlayer, from = 0) =>
	player.requests
		.slice(from)
		.filter((entry) => routeOf(entry.path).startsWith("/api/library/"));

const rowsAsks = (player: FakePlayer, from = 0) =>
	libraryAsks(player, from).filter((entry) => askOf(entry) === ROWS);

const positionsNamed = (body: Body) => {
	if (Array.isArray(body?.ordinals)) return body.ordinals as number[];
	return ((body?.runs ?? []) as [number, number][]).flatMap(([start, length]) =>
		Array.from({ length }, (_, step) => start + step),
	);
};

const windowsNamed = (body: Body) => [
	...new Set(
		positionsNamed(body).map((position) => Math.floor(position / WINDOW_ROWS)),
	),
];

const outsideTheFirstWindow = (body: Body) =>
	windowsNamed(body).filter((window) => window !== 0);

const isTileAsk = (body: Body) =>
	Array.isArray(body?.ordinals) &&
	body.ordinals.length > 0 &&
	body.ordinals.length <= HEADER_TILES_AT_MOST;

// What the library answered when a list opened, `others` aside, which counts every ask. The header's
// summary and its one ask for cover tiles may sit beside the runs and the window; a second window may not.
const openingAsks = (player: FakePlayer, from = 0) => {
	const asks = libraryAsks(player, from);
	const answered = asks.filter((entry) => entry.status === 200);
	const rows = answered.filter((entry) => askOf(entry) === ROWS);
	return {
		others: asks
			.map(askOf)
			.filter((ask) => ask !== RUNS && ask !== ROWS && ask !== SUMMARY),
		runs: answered.filter((entry) => askOf(entry) === RUNS).length,
		summaries: answered.filter((entry) => askOf(entry) === SUMMARY).length,
		tiles: rows.filter((entry) => isTileAsk(entry.body)).length,
		windows: rows
			.filter((entry) => !isTileAsk(entry.body))
			.map((entry) => entry.body),
	};
};

const expectNothingElseOfTheLibrary = (
	opened: ReturnType<typeof openingAsks>,
) => {
	expect(opened.others).toEqual([]);
	expect(opened.summaries).toBeLessThanOrEqual(1);
	expect(opened.tiles).toBeLessThanOrEqual(1);
	for (const body of opened.windows)
		expect(outsideTheFirstWindow(body)).toEqual([]);
};

// The status each library answer came back with, read in the browser: the fake's log has no status
// for a rows answer, and a declaration answered 202 and a window answered 200 are one POST to it.
const recordLibraryAnswers = (page: Page) => {
	const answers: { ask: string; status: number; body: Body }[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (!url.pathname.startsWith("/api/library/")) return;
		const request = response.request();
		answers.push({
			ask: `${request.method()} ${url.pathname}`,
			status: response.status(),
			body: request.method() === "POST" ? request.postDataJSON() : null,
		});
	});
	return {
		runs: () =>
			answers.filter((answer) => answer.ask === RUNS && answer.status === 200)
				.length,
		windows: () =>
			answers.filter(
				(answer) =>
					answer.ask === ROWS &&
					answer.status === 200 &&
					!isTileAsk(answer.body),
			).length,
	};
};

const holdRows = (page: Page, hold: boolean) =>
	page.request.post("/__control/holdRows", { data: { hold } });

const untilRowsAreHeld = (player: FakePlayer) =>
	expect
		.poll(() => player.fooJean.rowsHeld.length, {
			message: "All Music never asked for the rows under the viewport",
		})
		.toBeGreaterThan(0);

const titleAt = (player: FakePlayer, ordinal: number) =>
	String(player.ordinalOrder()[ordinal].track["%title%"]);

const expectLanded = async (page: Page, player: FakePlayer, index: number) => {
	await expect(trackRow(page, index)).not.toHaveAttribute("aria-busy", "true");
	await expect(trackRow(page, index)).toContainText(titleAt(player, index));
};

const openAllMusicHeld = async (page: Page, player: FakePlayer) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await untilRowsAreHeld(player);
	await expect(trackRow(page, 0)).toBeVisible();
};

const menuItem = (page: Page, name: string | RegExp) =>
	page.getByRole("menuitem", { name });

const openMenu = (page: Page) =>
	page.locator("body > div").filter({ has: menuItem(page, en["track.queue"]) });

const ARTIST_LINK = /^Go to /;

test.describe("opening All Music", () => {
	test("asks for the runs and the window under the viewport, and for no export, delta or second window", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryAnswers(page);
		await openAllMusic(page);
		await expectLanded(page, player, 0);
		await untilQuiet(player);

		expectNothingElseOfTheLibrary(openingAsks(player));
		expect(answered.runs()).toBe(1);
		// A fresh player holds no declaration, so a first rows request may be answered 202 while it builds
		// one, and may name no rows at all. Only one answer carries the window.
		expect(answered.windows()).toBe(1);
	});

	test("again, on a player that already holds the declaration, asks once for the runs and once for the window", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expectLanded(page, player, 0);
		await untilQuiet(player);

		const from = player.requests.length;
		await page.reload();
		await expectLanded(page, player, 0);
		await expectSettlesAt(
			player,
			() => {
				const { others, runs, windows } = openingAsks(player, from);
				return { others, runs, windows: windows.length };
			},
			{ others: [], runs: 1, windows: 1 },
		);
		const opened = openingAsks(player, from);
		expectNothingElseOfTheLibrary(opened);
		expect(windowsNamed(opened.windows[0])).toEqual([0]);
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("takes its length from the state's track count before any row has landed", async ({
			page,
			player,
		}) => {
			await openAllMusicHeld(page, player);

			await expect(page.getByRole("grid")).toHaveAttribute(
				"aria-rowcount",
				String(player.ordinalOrder().length),
			);
		});
	});
});

test.describe("coming back to All Music", () => {
	test.use({ mediaLibrarySize: 30441 });

	const REMEMBERED = 9 * WINDOW_ROWS + WINDOW_ROWS / 2;

	// Jean remembers a scroll position only within the tab's life, so this is leaving and coming back.
	// The structure moves while All Music is off screen, so no window it held can answer for it and
	// coming back has to ask.
	test("after the library moved, asks first for the window at the remembered position", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expectLanded(page, player, 0);
		await page.locator("main").evaluate((scroller, row) => {
			const grid = scroller.querySelector('[role="grid"]') as HTMLElement;
			const drawn = scroller.querySelector(
				'[role="row"][data-row]',
			) as HTMLElement;
			const margin =
				grid.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop;
			scroller.scrollTop = margin + row * drawn.getBoundingClientRect().height;
		}, REMEMBERED);
		await expectLanded(page, player, REMEMBERED);

		await page.goto(`/#/${guidOfPlaylist(player, "p1")}`);
		await expect(trackRow(page, 0)).toBeVisible();
		const structure = player.libraryFeed.structure;
		await page.request.post("/__control/library", {
			data: { add: 0, remove: 1 },
		});
		await expect
			.poll(() => player.libraryFeed.structure, {
				message: "the library never rebuilt",
			})
			.not.toBe(structure);

		const from = player.requests.length;
		await page.goto("/#/all");
		await expect
			.poll(() => rowsAsks(player, from).length, {
				message: "coming back asked for no rows",
			})
			.toBeGreaterThan(0);
		expect(windowsNamed(rowsAsks(player, from)[0].body)).toEqual([
			Math.floor(REMEMBERED / WINDOW_ROWS),
		]);
	});
});

declare global {
	interface Window {
		__bar: { busyAt: number | null; shownAt: number | null };
		__opened: string[];
	}
}

// When row 0 was first drawn busy, and when a bar inside it was first drawn at all. A bar is what
// `Skeleton` draws: an empty element hidden from the accessibility tree, with a box. A row's cover
// placeholder is hidden too and shows at once, and it holds an icon. The busy moment is read off
// the mutation itself rather than a frame, so a slow frame can only lengthen what is measured.
const recordTheFirstBar = (page: Page) =>
	page.addInitScript(() => {
		const bar = {
			busyAt: null as number | null,
			shownAt: null as number | null,
		};
		window.__bar = bar;
		const BUSY_ROW = '[role="row"][data-row="0"][aria-busy="true"]';
		new MutationObserver(() => {
			if (document.querySelector(BUSY_ROW)) bar.busyAt ??= performance.now();
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["aria-busy"],
		});
		const opacityWithin = (element: Element, row: Element) => {
			let opacity = 1;
			for (let at: Element | null = element; at; at = at.parentElement) {
				opacity *= Number(getComputedStyle(at).opacity);
				if (at === row) break;
			}
			return opacity;
		};
		const look = () => {
			const row = document.querySelector(BUSY_ROW);
			const shown =
				row !== null &&
				[...row.querySelectorAll('[aria-hidden="true"]:empty')].some(
					(element) => {
						const box = element.getBoundingClientRect();
						return (
							box.width > 0 && box.height > 0 && opacityWithin(element, row) > 0
						);
					},
				);
			if (shown) bar.shownAt ??= performance.now();
			if (bar.shownAt === null) requestAnimationFrame(look);
		};
		requestAnimationFrame(look);
	});

const BAR_DELAY_MS = 300;
// `performance.now()` is coarsened by the browser.
const CLOCK_SLACK_MS = 5;

test.describe("a pending row", () => {
	test.use({ fooJean: { holdRows: true } });

	test("draws busy at the row's own height, shows no bar for its first 300 ms and one after, and nothing moves when its window lands", async ({
		page,
		player,
	}) => {
		await recordTheFirstBar(page);
		await openAllMusicHeld(page, player);

		const rows = [0, 1, 2].map((index) => trackRow(page, index));
		for (const row of rows)
			await expect(row).toHaveAttribute("aria-busy", "true");

		await expect
			.poll(() => page.evaluate(() => window.__bar.shownAt), {
				message: "a pending row never showed its bar",
			})
			.not.toBeNull();
		const { busyAt, shownAt } = await page.evaluate(() => window.__bar);
		expect(
			(shownAt as number) - (busyAt as number),
			"the bar showed before the row had been pending for 300 ms",
		).toBeGreaterThanOrEqual(BAR_DELAY_MS - CLOCK_SLACK_MS);

		const boxesOf = (all: Locator[]) =>
			Promise.all(all.map((row) => row.boundingBox()));
		const pending = await boxesOf(rows);

		await holdRows(page, false);
		await expectLanded(page, player, 0);
		for (const [index, row] of rows.entries())
			await expect(row).toContainText(titleAt(player, index));
		expect(await boxesOf(rows)).toEqual(pending);
	});

	test("takes the cursor and a selection from the keyboard", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"the compact viewport selects through the row's menu, which the menu case covers",
		);
		await openAllMusicHeld(page, player);

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");

		await expect(
			page.locator('[role="row"][data-cursor="true"][aria-busy="true"]'),
		).toHaveCount(1);
		await expect(
			page.locator('[role="row"][aria-selected="true"][aria-busy="true"]'),
		).toHaveCount(3);
		expect(player.fooJean.rowsHeld.length).toBeGreaterThan(0);
	});

	test("plays the track at its position", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusicHeld(page, player);

		// Not row 0: a set comes back in the player's own browse order, which agrees with the path order
		// often enough that the first row proves nothing.
		const index = 3;
		if (isMobile) await trackRow(page, index).tap();
		else await trackRow(page, index).dblclick();

		await expect.poll(() => playedFrom(player)?.index).toBe(index);
		expect(playedFrom(player)?.id).toBe(scratchOf(player)?.guid);
		expect(player.fooJean.rowsHeld.length).toBeGreaterThan(0);

		await holdRows(page, false);
		await expect(trackRow(page, index)).toContainText(trackPlayed(player)!);
	});

	test("queues the track at its position from its menu", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusicHeld(page, player);

		const index = 2;
		await openRowMenu(page, isMobile, index, en["track.queue"]);
		await menuItem(page, en["track.queue"]).click();
		await expect.poll(() => player.queuedEntries().length).toBe(1);
		expect(player.fooJean.rowsHeld.length).toBeGreaterThan(0);

		await holdRows(page, false);
		await expect(trackRow(page, index)).toContainText(
			String(player.queuedEntries()[0].track["%title%"]),
		);
	});

	test("opens a menu under a skeleton header with what needs only its position, and offers rating and the artist once its row lands", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusicHeld(page, player);

		const index = 0;
		await openRowMenu(page, isMobile, index, en["track.queue"]);
		const menu = openMenu(page);
		await expect(menu.locator('[aria-busy="true"]')).not.toHaveCount(0);
		await expect(menu).not.toContainText(en["track.unknownTitle"]);
		await expect(menuItem(page, en["track.queue"])).toBeEnabled();
		await expect(menuItem(page, en["track.addToPlaylist"])).toBeEnabled();
		// Read once rather than retried: the menu has drawn, and a retrying read would pass on an item
		// that showed and went away.
		expect(await menuItem(page, en["rating.title"]).count()).toBe(0);
		expect(await menuItem(page, ARTIST_LINK).count()).toBe(0);
		// A right click selects the row it opens on; a hold on a phone opens the menu and selects nothing.
		if (!isMobile)
			await expect(trackRow(page, index)).toHaveAttribute(
				"aria-selected",
				"true",
			);

		await page.keyboard.press("Escape");
		await expect(menuItem(page, en["track.queue"])).toHaveCount(0);
		await holdRows(page, false);
		await expectLanded(page, player, index);

		await openRowMenu(page, isMobile, index, en["track.queue"]);
		await expect(openMenu(page)).toContainText(titleAt(player, index));
		await expect(menuItem(page, en["rating.title"])).toBeVisible();
		await expect(menuItem(page, ARTIST_LINK)).toBeVisible();
	});

	test.describe("dragged onto a playlist", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"the sidebar is a drawer on a phone and a drag onto it is mouse-only; touch adds through the menu",
		);

		const ORDINARY = ["p1", "p2", "p5", "p7"];
		const playlistWithout = (player: FakePlayer, ordinal: number) => {
			const path = player.ordinalOrder()[ordinal].track["%path%"];
			const found = player.playlists.find(
				(entry) =>
					ORDINARY.includes(entry.id) &&
					!entry.items.some((track) => track["%path%"] === path),
			);
			if (!found) throw new Error(`every playlist holds ordinal ${ordinal}`);
			return found;
		};

		// Matched on the label's own text: `Library` is inside `#Jean Library`.
		const sidebarRow = (page: Page, title: string) =>
			sidebar(page)
				.locator("> div")
				.filter({ has: page.getByText(title, { exact: true }) });

		const ghost = (page: Page) => page.locator('[data-armed="true"]');

		const ONE_TRACK = (en["view.trackCount"] as { one: string }).one.replace(
			"{total}",
			"1",
		);

		test("is labelled with the count of its selection where a landed row's label is its title, and is added there", async ({
			page,
			player,
		}) => {
			await openAllMusicHeld(page, player);
			await openSidebar(page);
			const playlist = playlistWithout(player, 0);
			const target = sidebarRow(page, playlist.title);
			const into = () => playlist.items;
			const before = into().length;

			await dragFrom(page, trackRow(page, 0), target);
			await expect(target).toHaveAttribute("data-drop-over", "true");
			await expect(ghost(page)).toHaveText(ONE_TRACK);
			await page.mouse.up();

			await expect.poll(() => into().length).toBe(before + 1);
			expect(into().at(-1)?.["%title%"]).toBe(titleAt(player, 0));
			expect(player.fooJean.rowsHeld.length).toBeGreaterThan(0);

			await holdRows(page, false);
			await expectLanded(page, player, 0);
			await dragFrom(page, trackRow(page, 0), target);
			await expect(target).toHaveAttribute("data-drop-over", "true");
			await expect(ghost(page)).toHaveText(titleAt(player, 0));
		});
	});
});

test.describe("a question held on a declaration", () => {
	test.use({ fooJean: { holdRows: true } });

	// foo_jean answers 409 for an expression no declaration names, and the fake declares whatever the
	// first read asks, so the refusal is made in the browser.
	test("is asked again once a rows answer lands, and not before", async ({
		page,
		player,
	}) => {
		let refused = 0;
		await page.route(
			(url) => url.pathname === "/api/library/search",
			(route) => {
				if (refused > 0) return route.fallback();
				refused += 1;
				return route.fulfill({
					status: 409,
					json: { error: "'%artist%' is not a declared column", detail: "" },
				});
			},
		);
		await openAllMusicHeld(page, player);

		await revealSearch(page);
		await searchField(page).fill("babasonicos");
		await expect.poll(() => refused).toBe(1);
		await untilQuiet(player);
		expect(
			libraryAsks(player).filter(
				(entry) => routeOf(entry.path) === "/api/library/search",
			),
		).toEqual([]);

		await holdRows(page, false);
		await expect(
			page.getByRole("option", { name: /Babasónicos/ }).first(),
		).toBeVisible();
	});
});

test.describe("field availability", () => {
	test.use({ withoutFields: ["%lastfm_play_count%"] });

	const PLAYS_UNAVAILABLE = en["columns.unavailable"].replace(
		"{column}",
		en["column.playCount"],
	);

	const expectPlaysUnavailable = async (page: Page) => {
		await page.getByRole("button", { name: en["columns.viewOptions"] }).click();
		const plays = page.getByRole("menuitemcheckbox", {
			name: PLAYS_UNAVAILABLE,
		});
		await expect(plays).toBeVisible();
		await expect(plays).toBeDisabled();
		await page.keyboard.press("Escape");
	};

	test("is read from the first rows answer, and held across a reload before any rows land", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expectLanded(page, player, 0);
		await expectPlaysUnavailable(page);

		await holdRows(page, true);
		await page.reload();
		await untilRowsAreHeld(player);
		await expectPlaysUnavailable(page);
	});
});

test.describe("the library in the browser", () => {
	test("opening All Music starts no worker and opens no jean-library database", async ({
		page,
		player,
	}) => {
		const workers: string[] = [];
		page.on("worker", (worker) => workers.push(worker.url()));
		await page.addInitScript(() => {
			window.__opened = [];
			const open = indexedDB.open.bind(indexedDB);
			indexedDB.open = (name: string, version?: number) => {
				window.__opened.push(name);
				return open(name, version);
			};
		});

		await openAllMusic(page);
		await expectLanded(page, player, 0);
		await untilQuiet(player);

		expect(workers).toEqual([]);
		expect(await page.evaluate(() => window.__opened)).not.toContain(
			"jean-library",
		);
	});
});

const TWO_MILLION = 2_000_000;
const TWO_MILLION_MS = 10 * 60_000;
const LANDS_MS = 6 * 60_000;
const SETTLES_MS = 60_000;

test.describe("a library of two million tracks", { tag: "@firefox" }, () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the height limit is the engine's, which this project shares with desktop",
	);
	test.setTimeout(TWO_MILLION_MS);
	test.use({
		libraryShape: {
			tracks: TWO_MILLION,
			albums: TWO_MILLION / 10,
			artists: TWO_MILLION / 100,
			genres: 40,
			years: [1960, 2024],
		},
		settings: { "jean.followPlayback": false },
	});

	const LAST = TWO_MILLION - 1;

	const isOnScreen = (page: Page, index: number) =>
		page.locator("main").evaluate((scroller, wanted) => {
			const row = scroller.querySelector(`[role="row"][data-row="${wanted}"]`);
			if (!row) return false;
			const seen = row.getBoundingClientRect();
			const view = scroller.getBoundingClientRect();
			return seen.top >= view.top - 1 && seen.bottom <= view.bottom + 1;
		}, index);

	test("opens on the runs and one window, and reaches the last row by End and by the scrollbar", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryAnswers(page);
		await page.goto("/#/all");
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(TWO_MILLION),
			{ timeout: LANDS_MS },
		);
		await expect(trackRow(page, 0)).toContainText(titleAt(player, 0), {
			timeout: LANDS_MS,
		});
		await untilQuiet(player);
		expectNothingElseOfTheLibrary(openingAsks(player));
		expect(answered.runs()).toBe(1);
		expect(answered.windows()).toBe(1);

		await page.keyboard.press("End");
		await expect
			.poll(() => isOnScreen(page, LAST), { timeout: SETTLES_MS })
			.toBe(true);
		await expect(trackRow(page, LAST)).toHaveAttribute("data-cursor", "true");
		await expect(trackRow(page, LAST)).toContainText(titleAt(player, LAST), {
			timeout: SETTLES_MS,
		});

		await page.keyboard.press("Home");
		await expect
			.poll(() => isOnScreen(page, 0), { timeout: SETTLES_MS })
			.toBe(true);

		await expect
			.poll(
				async () => {
					await page.locator("main").evaluate((scroller) => {
						scroller.scrollTop = scroller.scrollHeight;
					});
					return isOnScreen(page, LAST);
				},
				{ timeout: SETTLES_MS },
			)
			.toBe(true);
		await expect(trackRow(page, LAST)).toContainText(titleAt(player, LAST), {
			timeout: SETTLES_MS,
		});
	});
});

const heatOf = (plays: number, mostPlays: number) =>
	plays > 0 && mostPlays > 0 ? Math.log1p(plays) / Math.log1p(mostPlays) : 0;

const heatAt = (page: Page, index: number) =>
	trackRow(page, index).evaluate((row) =>
		Number(getComputedStyle(row).getPropertyValue("--heat")),
	);

// The runs the player answered, with the figures replaced by ones no sum over the playlist's rows
// gives, so a header or a heat drawn from the rows cannot pass for one drawn from the runs.
const rewriteRuns = (
	page: Page,
	player: FakePlayer,
	key: string,
	replaced: Record<string, unknown>,
) =>
	page.route(
		(url) =>
			url.pathname === `/api/playlists/${guidOfPlaylist(player, key)}/runs`,
		async (route) => {
			const answered = await route.fetch();
			if (answered.status() !== 200)
				return route.fulfill({ response: answered });
			const etag = answered.headers().etag;
			return route.fulfill({
				status: 200,
				json: { ...(await answered.json()), ...replaced },
				headers: etag ? { ETag: etag } : {},
			});
		},
	);

const SPANISH = "p5";

const openPlaylist = async (page: Page, player: FakePlayer, key: string) => {
	await page.goto(`/#/${guidOfPlaylist(player, key)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: titleOfPlaylist(player, key) }),
	).toBeVisible();
};

test.describe("opening a playlist", () => {
	test.use({ librarySize: LONG_PLAYLIST_ROWS });

	test("asks its runs and the one window under the viewport, and nothing else of it", async ({
		page,
		player,
	}) => {
		const runs = recordRunsAnswers(page, player, LONG_PLAYLIST);
		await openPlaylist(page, player, LONG_PLAYLIST);
		await expectRowLanded(page, 0, titleIn(player, LONG_PLAYLIST, 0));
		await untilQuiet(player);

		const opened = playlistAsksOf(player, LONG_PLAYLIST);
		// A first runs ask may be answered 202 while the library builds the declaration it names.
		expect(runs.filter((answer) => answer.status === 200)).toHaveLength(1);
		expect(opened.windows).toEqual([{ offset: 0, count: WINDOW_ROWS }]);
		expect(opened.others).toEqual([]);
		expectTileAsksAtMost(opened.tiles);
	});

	test.describe("with the second window held", () => {
		test("takes its length from the page, draws the held window's rows busy, and plays one by its position", async ({
			page,
			player,
			isMobile,
		}) => {
			const pages = await holdPlaylistPages(
				page,
				player,
				LONG_PLAYLIST,
				fromTheSecondWindow,
			);
			await openPlaylist(page, player, LONG_PLAYLIST);
			await expectRowLanded(page, 0, titleIn(player, LONG_PLAYLIST, 0));
			await expect(page.getByRole("grid")).toHaveAttribute(
				"aria-rowcount",
				String(LONG_PLAYLIST_ROWS),
			);

			const index = WINDOW_ROWS + 52;
			await scrollToRow(page, index - 5);
			await expect(trackRow(page, index)).toBeVisible();
			await expect.poll(() => pages.held.length).toBeGreaterThan(0);
			await expectRowPending(page, index);
			await expect(trackRow(page, index)).not.toContainText(
				titleIn(player, LONG_PLAYLIST, index),
			);

			if (isMobile) await trackRow(page, index).tap();
			else await trackRow(page, index).dblclick();
			await expect
				.poll(() => playedFrom(player))
				.toEqual({
					id: guidOfPlaylist(player, LONG_PLAYLIST),
					index,
				});
			expect(
				pages.held.length,
				"the page landed before the play went out",
			).toBeGreaterThan(0);

			await pages.release();
			await expectRowLanded(page, index, trackPlayed(player) ?? "");
		});
	});
});

test.describe("a playlist whose read is refused", () => {
	// What foo_jean answers when foobar2000 did not answer in time, which a busy player reaches on
	// its own.
	const TOO_SLOW = { status: 504, error: "foobar2000 did not answer in time" };
	const FAILED = en["playlist.loadFailed"].replace("{message}", TOO_SLOW.error);

	const refuse = (route: Route) =>
		route.fulfill({
			status: TOO_SLOW.status,
			json: { error: TOO_SLOW.error, detail: "" },
		});

	test("says so with the player's own words where its first page is refused, and draws no row and reads no library", async ({
		page,
		player,
	}) => {
		await page.route(
			(url) =>
				url.pathname ===
				`/api/playlists/${guidOfPlaylist(player, SPANISH)}/items`,
			refuse,
		);
		await page.goto(`/#/${guidOfPlaylist(player, SPANISH)}`);

		await expect(page.getByText(FAILED)).toBeVisible();
		await untilQuiet(player);
		expect(await page.locator('main [role="row"]').count()).toBe(0);
	});

	test("keeps the rows it drew and says nothing where its runs are refused after they landed", async ({
		page,
		player,
	}) => {
		let refused = 0;
		let runsAnswered = 0;
		await page.route(
			(url) =>
				url.pathname ===
				`/api/playlists/${guidOfPlaylist(player, SPANISH)}/runs`,
			(route) => {
				if (runsAnswered === 0) {
					runsAnswered += 1;
					return route.fallback();
				}
				refused += 1;
				return refuse(route);
			},
		);
		await openPlaylist(page, player, SPANISH);
		const first = titleIn(player, SPANISH, 0);
		await expectRowLanded(page, 0, first);

		player.playItem(SPANISH, 1);
		player.retagPlaying({ "%title%": "Retagged while the runs are refused" });
		await expect.poll(() => refused).toBeGreaterThan(0);
		await untilQuiet(player);

		await expect(trackRow(page, 0)).toContainText(first);
		await expect(trackRow(page, 1)).toContainText(
			"Retagged while the runs are refused",
		);
		expect(await page.getByText(FAILED).count()).toBe(0);
	});

	// A playlist's failed read waits 5 s before it is asked again. Left for All Music, it is nobody's
	// to ask, and All Music's own rows owe it no wait.
	test("left for All Music while its first page is refused, holds All Music's rows back by nothing and is asked for no more", async ({
		page,
		player,
	}) => {
		const ITEMS = `/api/playlists/${guidOfPlaylist(player, SPANISH)}/items`;
		// Inside the 5 s a refused read waits, with room for a loaded machine.
		const AT_ONCE_MS = 3_000;
		// Past the first wait a refused read would be asked again after.
		const PAST_THE_FIRST_RETRY_MS = 6_000;

		const refusedAt: number[] = [];
		await page.route(
			(url) => url.pathname === ITEMS,
			(route) => {
				refusedAt.push(Date.now());
				return refuse(route);
			},
		);
		await page.goto(`/#/${guidOfPlaylist(player, SPANISH)}`);
		await expect
			.poll(() => refusedAt.length, {
				message: "the playlist never asked for its first page",
			})
			.toBeGreaterThan(0);

		const leftAt = Date.now();
		await page.evaluate(() => {
			location.hash = "#/all";
		});
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toContainText(titleAt(player, 0), {
			timeout: AT_ONCE_MS,
		});

		await page.waitForTimeout(PAST_THE_FIRST_RETRY_MS);
		expect(
			refusedAt.filter((at) => at > leftAt),
			"the playlist left behind was asked for again",
		).toEqual([]);
	});
});

test.describe("a playlist's header and heat", () => {
	const DRAWN = {
		albumCount: 77,
		seconds: 3 * 86_400 + 4 * 3_600 + 120,
		earliestYear: 1901,
		latestYear: 2099,
		mostPlays: 9_999,
	};

	const figure = (page: Page, name: string) =>
		viewHeader(page).locator(`p[data-figures] span[data-figure="${name}"]`);

	test("draw the four figures from its runs answer, and shade each row against the answer's most plays", async ({
		page,
		player,
	}) => {
		await rewriteRuns(page, player, SPANISH, DRAWN);
		await openPlaylist(page, player, SPANISH);
		const tracks = player.playlists.find(
			(entry) => entry.id === SPANISH,
		)!.items;
		await expectRowLanded(page, 0, String(tracks[0]["%title%"]));

		await expect(figure(page, "albums")).toHaveText("77 albums");
		await expect(figure(page, "tracks")).toHaveText(`${tracks.length} tracks`);
		await expect(figure(page, "duration")).toHaveText("3 days 4 hr");
		await expect(figure(page, "span")).toHaveText("1901-2099");

		const hottest = tracks.reduce(
			(best, track, at) => (playsOf(track) > playsOf(tracks[best]) ? at : best),
			0,
		);
		expect(playsOf(tracks[hottest])).toBeGreaterThan(0);
		await expect
			.poll(() => heatAt(page, hottest))
			.toBeCloseTo(heatOf(playsOf(tracks[hottest]), DRAWN.mostPlays), 2);
	});
});

test.describe("a playlist's album groups", () => {
	test.use({ settings: { "jean.layout": "album" } });

	test("come from its runs answer, where its rows would draw one", async ({
		page,
		player,
	}) => {
		await rewriteRuns(page, player, SPANISH, { lengths: [5, 7] });
		await openPlaylist(page, player, SPANISH);

		await expect
			.poll(() =>
				page
					.locator("main [data-span-start]")
					.evaluateAll((groups) =>
						groups.map((group) => [
							Number(group.getAttribute("data-span-start")),
							Number(group.getAttribute("data-span-count")),
						]),
					),
			)
			.toEqual([
				[0, 5],
				[5, 7],
			]);
	});
});

test.describe("a playlist whose revision moves", () => {
	// A row's count retagged at the player stands in for a play: the fake counts a play into the
	// library and the playlist's copies without moving the playlist's revision, which a play moves
	// on a real player. Below the playlist's most played row, so no run and no figure moves.
	const COUNTED = "97";

	test("patches the changed row in from one changes read since the revision held, reads no page again, and revalidates the runs to a 304", async ({
		page,
		player,
	}) => {
		const runs = recordRunsAnswers(page, player, SPANISH);
		await openPlaylist(page, player, SPANISH);
		const index = 2;
		const before = titleIn(player, SPANISH, index);
		await expectRowLanded(page, index, before);
		await untilQuiet(player);
		await expect(trackRow(page, index)).not.toContainText(COUNTED);
		const firstRuns = runs.find((answer) => answer.status === 200);
		expect(firstRuns?.etag, "the runs carried no ETag").toBeTruthy();
		const held = String(
			player.playlists.find((entry) => entry.id === SPANISH)!.revision,
		);

		const from = player.requests.length;
		player.playItem(SPANISH, index);
		player.retagPlaying({
			"%lastfm_play_count%": COUNTED,
			"%play_count%": COUNTED,
		});

		await expect(trackRow(page, index)).toContainText(COUNTED);
		await expect(trackRow(page, index)).toContainText(before);
		await expectSettlesAt(player, () => pageAsks(player, SPANISH, from), []);
		const changes = player.requests
			.slice(from)
			.filter(
				(entry) =>
					entry.method === "GET" &&
					routeOf(entry.path) ===
						`/api/playlists/${guidOfPlaylist(player, SPANISH)}/items/changes`,
			)
			.map((entry) =>
				new URLSearchParams(entry.path.split("?")[1]).get("since"),
			);
		expect(changes).toEqual([held]);

		await expect
			.poll(() =>
				runs
					.slice(1)
					.map(({ status, ifNoneMatch }) => ({ status, ifNoneMatch })),
			)
			.toContainEqual({ status: 304, ifNoneMatch: firstRuns?.etag ?? null });
	});
});

test.describe("an autoplaylist of two million tracks", {
	tag: "@firefox",
}, () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the height limit is the engine's, which this project shares with desktop",
	);
	test.setTimeout(TWO_MILLION_MS);
	test.use({
		libraryShape: {
			tracks: TWO_MILLION,
			albums: TWO_MILLION / 10,
			artists: TWO_MILLION / 100,
			genres: 40,
			years: [1960, 2024],
		},
		settings: { "jean.followPlayback": false },
	});

	const LAST = TWO_MILLION - 1;
	const DEEP = 1_234_567;
	const WHOLE = "Whole library";

	// The fixture builds no autoplaylist of the generated library, as `pnpm fake --tracks` does, so
	// the spec makes the same one.
	const wholeLibrary = (player: FakePlayer) => {
		const made = player.addPlaylist(WHOLE);
		const playlist = player.playlistById(made.id);
		if (!playlist) throw new Error("the fake made no playlist");
		playlist.isAuto = true;
		playlist.items = [...player.libraryTracks];
		return playlist.id;
	};

	test("opens on its runs and one window, reaches its last row by End and by the scrollbar, jumps to a playing row deep in it, and is where it was left on coming back", async ({
		page,
		player,
	}) => {
		const key = wholeLibrary(player);
		const runs = recordRunsAnswers(page, player, key);
		await page.goto(`/#/${guidOfPlaylist(player, key)}`);
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(TWO_MILLION),
			{ timeout: LANDS_MS },
		);
		await expect(trackRow(page, 0)).toContainText(titleIn(player, key, 0), {
			timeout: LANDS_MS,
		});
		await expect
			.poll(() => runs.filter((answer) => answer.status === 200).length, {
				timeout: SETTLES_MS,
			})
			.toBe(1);
		await untilQuiet(player);
		const opened = playlistAsksOf(player, key);
		expect(opened.windows).toEqual([{ offset: 0, count: WINDOW_ROWS }]);
		expect(opened.others).toEqual([]);
		expectTileAsksAtMost(opened.tiles);

		await page.keyboard.press("End");
		await expect
			.poll(() => isRowOnScreen(page, LAST), { timeout: SETTLES_MS })
			.toBe(true);
		await expect(trackRow(page, LAST)).toHaveAttribute("data-cursor", "true");
		await expect(trackRow(page, LAST)).toContainText(
			titleIn(player, key, LAST),
			{
				timeout: SETTLES_MS,
			},
		);

		await page.keyboard.press("Home");
		await expect
			.poll(() => isRowOnScreen(page, 0), { timeout: SETTLES_MS })
			.toBe(true);

		await expect
			.poll(
				async () => {
					await page.locator("main").evaluate((scroller) => {
						scroller.scrollTop = scroller.scrollHeight;
					});
					return isRowOnScreen(page, LAST);
				},
				{ timeout: SETTLES_MS },
			)
			.toBe(true);
		await expect(trackRow(page, LAST)).toContainText(
			titleIn(player, key, LAST),
			{ timeout: SETTLES_MS },
		);

		player.playItem(key, DEEP);
		await expect(statusBar(page)).toContainText(titleIn(player, key, DEEP));
		await page.keyboard.press("Home");
		await expect
			.poll(() => isRowOnScreen(page, 0), { timeout: SETTLES_MS })
			.toBe(true);
		await page.keyboard.press("n");
		await expect
			.poll(() => isRowOnScreen(page, DEEP), { timeout: SETTLES_MS })
			.toBe(true);
		await expect(trackRow(page, DEEP)).toHaveAttribute("data-active", "true");
		await expect(trackRow(page, DEEP)).toContainText(
			titleIn(player, key, DEEP),
			{ timeout: SETTLES_MS },
		);

		await openPlaylist(page, player, SPANISH);
		await openPlaylist(page, player, key);
		await expect
			.poll(() => isRowOnScreen(page, DEEP), { timeout: SETTLES_MS })
			.toBe(true);
	});
});
