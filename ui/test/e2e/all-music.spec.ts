import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { en } from "../../src/shared/i18n/en.ts";
import { compareText, pathKey } from "../fake-api/playerOrder.ts";
import type { Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	openSidebar,
	playedFrom,
	requestsTo,
	scratchFills,
	scratchOf,
	searchFor,
	sidebar,
	statusBar,
	test,
	trackPlayed,
	trackRow,
	viewHeader,
} from "./fixtures.ts";
import { scrollTo, scrollTop } from "./scrolling.ts";

test.describe("playing from all music", () => {
	// Big enough that the set cannot be named track by track: as ordinals it
	// outgrows the component's own 256 KiB. The synthesised tracks
	// also sit in a different order by tag than by path -- see `ordinalOrder` in
	// the fake.
	test.use({ mediaLibrarySize: 30441 });

	test("the whole library is asked for, not named track by track", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"30441",
		);

		await trackRow(page, 0).dblclick();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			30441,
		);

		expect(scratchFills(player)).toHaveLength(1);
	});

	test("the row you click is the row that plays", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Not row 0: a set comes back in the player's own browse order, which
		// agrees with the path order often enough that the first row proves
		// nothing.
		await trackRow(page, 12).dblclick();
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);
	});
});

test.describe("the order a set is played in", () => {
	test.use({ mediaLibrarySize: 4000 });

	test("a search result plays the result that was clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "nutshell");
		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(10);

		await trackRow(page, 7).dblclick();
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 7)).toContainText(trackPlayed(player)!);
	});

	test("the playlist is left in the order the view shows, whatever the player did", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();

		// The set arriving whole, and deliberately not the request log coming to
		// rest: one call fills this playlist, so there is no later round trip to
		// wait for, and waiting for one would let a client that fixed the order up
		// afterwards pass.
		await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(4000);

		const held = scratchOf(player)!.items.map((track) =>
			pathKey(track["%path%"]),
		);
		expect(held).toEqual([...held].sort(compareText));
	});
});

test.describe("where the music is coming from", () => {
	test.use({ mediaLibrarySize: 4000 });

	const allMusicRow = (page: Page) =>
		sidebar(page).getByRole("button", { name: /All music/ });

	test("All music is marked as playing, in the row it already has", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Scoped to this row rather than the whole sidebar: a user playlist marks
		// itself from `isCurrent` and the player arrives with one already set.
		await expect(allMusicRow(page).getByLabel("Playing from here")).toHaveCount(
			0,
		);

		await trackRow(page, 3).dblclick();

		// Before the drawer: on a phone the sidebar covers the status bar, and the
		// way into the now-playing screen is in it.
		await expectPlayingFrom(page, "All music");

		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(1);
	});

	test("browsing away leaves the mark where the sound is", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();
	});

	test("a live search is not marked by somebody else playing", async ({
		page,
	}) => {
		// The search row draws itself whenever a query is typed, so it exists here
		// alongside the set that is actually playing.
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();

		await page.goto("/#/search");
		await searchFor(page, "nutshell");
		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(10);

		await openSidebar(page);
		const search = sidebar(page).getByRole("button", { name: /nutshell/ });
		await expect(search).toBeVisible();
		await expect(search.getByLabel("Playing from here")).toHaveCount(0);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();
	});
});

test.describe("a component that is answering", () => {
	test("all music offers Play and Shuffle", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		const header = viewHeader(page);
		await expect(
			header.getByRole("button", { name: "Play", exact: true }),
		).toBeEnabled();
		await expect(
			header.getByRole("button", { name: "Shuffle", exact: true }),
		).toBeEnabled();
	});
});

test.describe("a component that is not answering", () => {
	test.use({ fooJean: { reachable: false } });

	// The other half of the same question. Play and Shuffle wait on the
	// component being reachable, so with nothing answering there is nothing to
	// fill a playlist from and no set to play.
	test("all music offers neither Play nor Shuffle", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.locator("main").getByText(en["fooJean.unreachable.summary"]),
		).toBeVisible();

		await expect(
			page.locator("main").getByRole("button", { name: /^(Play|Shuffle)$/ }),
		).toHaveCount(0);
	});
});

// Firefox's own limit is the one this leaves room under.
const MAX_SCROLL_HEIGHT = 15_000_000;

const scroller = (page: Page) => page.locator("main");

const settle = (page: Page) =>
	page.evaluate(
		([stillFrames, capMs]: [number, number]) =>
			new Promise<void>((resolve) => {
				const element = document.querySelector("main") as HTMLElement;
				let last = "";
				let still = 0;
				const until = performance.now() + capMs;
				const tick = () => {
					const rows = [...element.querySelectorAll("[data-row]")]
						.map((row) => row.getAttribute("data-row"))
						.join();
					const now = `${element.scrollTop}/${element.scrollHeight}/${rows}`;
					still = now === last ? still + 1 : 0;
					last = now;
					if (still >= stillFrames || performance.now() >= until) resolve();
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		[10, 5_000] as [number, number],
	);

const rowAtTop = (page: Page) =>
	scroller(page).evaluate((element) => {
		const top = element.getBoundingClientRect().top + 1;
		for (const row of element.querySelectorAll("[data-row]")) {
			const seen = row.getBoundingClientRect();
			if (seen.top <= top && top < seen.bottom)
				return Number(row.getAttribute("data-row"));
		}
		return null;
	});

const scrollToTheBottom = (page: Page) =>
	scroller(page).evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});

const listGeometry = (page: Page) =>
	scroller(page).evaluate((element) => {
		const grid = element.querySelector('[role="grid"]') as HTMLElement;
		const row = element.querySelector('[role="row"][data-row]') as HTMLElement;
		return {
			scrollHeight: element.scrollHeight,
			margin:
				grid.getBoundingClientRect().top -
				element.getBoundingClientRect().top +
				element.scrollTop,
			listHeight: grid.getBoundingClientRect().height,
			rowHeight: row.getBoundingClientRect().height,
		};
	});

test.describe("a library under the scroll cap", () => {
	test.use({ mediaLibrarySize: 30441 });

	test("scrolls one pixel to one pixel of list: the list is as tall as its rows, and a scroll offset lands on the same row", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"30441",
		);
		await expect(trackRow(page, 0)).toBeAttached();

		const { margin, listHeight, rowHeight } = await listGeometry(page);
		expect(listHeight).toBe(30441 * rowHeight);

		const deep = 30000;
		await scroller(page).evaluate(
			(element, to) => {
				element.scrollTop = to;
			},
			margin + deep * rowHeight,
		);
		await settle(page);
		expect(await rowAtTop(page)).toBe(deep);
	});
});

// A million rows at full height is past the tallest element Firefox, Chromium or WebKit will draw.
const MILLION = 1_000_000;
const LAST = MILLION - 1;
const DEEP = 800_000;
const MILLION_MS = 10 * 60_000;
const LIBRARY_LANDS_MS = 6 * 60_000;
const SETTLES_MS = 60_000;

test.describe("a library of a million tracks", { tag: "@firefox" }, () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the height limit is the engine's, which this project shares with desktop; a fling over the cap is checked by hand on a phone",
	);
	test.setTimeout(MILLION_MS);

	test.use({
		libraryShape: {
			tracks: MILLION,
			albums: MILLION / 10,
			artists: MILLION / 100,
			genres: 40,
			years: [1960, 2024],
		},
		fooJean: { libraryCeiling: null },
		settings: { "jean.followPlayback": false },
	});

	const openAMillion = async (page: Page) => {
		await page.goto("/#/all");
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(MILLION),
			{ timeout: LIBRARY_LANDS_MS },
		);
		await expect(trackRow(page, 0)).toBeAttached();
	};

	const whereRowIs = (page: Page, index: number) =>
		scroller(page).evaluate((element, wanted) => {
			const view = element.getBoundingClientRect();
			const at = `scrollTop ${Math.round(element.scrollTop)} of ${element.scrollHeight - element.clientHeight}`;
			const row = element.querySelector(`[role="row"][data-row="${wanted}"]`);
			if (!row) {
				const mounted = [...element.querySelectorAll("[data-row]")].map(
					(entry) => Number(entry.getAttribute("data-row")),
				);
				return `row ${wanted} not mounted at ${at}; rows ${Math.min(...mounted)} to ${Math.max(...mounted)} are`;
			}
			const seen = row.getBoundingClientRect();
			return seen.top >= view.top - 1 && seen.bottom <= view.bottom + 1
				? "on screen"
				: `row ${wanted} drawn at ${Math.round(seen.top)} to ${Math.round(seen.bottom)}, outside ${Math.round(view.top)} to ${Math.round(view.bottom)}, at ${at}`;
		}, index);

	const offCentre = (page: Page, index: number) =>
		scroller(page).evaluate((element, wanted) => {
			const row = element.querySelector(`[role="row"][data-row="${wanted}"]`);
			if (!row) return Number.POSITIVE_INFINITY;
			const seen = row.getBoundingClientRect();
			const view = element.getBoundingClientRect();
			return Math.abs(
				(seen.top + seen.bottom) / 2 - (view.top + view.bottom) / 2,
			);
		}, index);

	const expectOnScreen = async (page: Page, index: number) => {
		await expect
			.poll(() => whereRowIs(page, index), { timeout: SETTLES_MS })
			.toBe("on screen");
	};

	const scrollUntilTheLastRowIsShown = async (page: Page) => {
		await expect
			.poll(
				async () => {
					await scrollToTheBottom(page);
					await settle(page);
					return whereRowIs(page, LAST);
				},
				{ timeout: SETTLES_MS },
			)
			.toBe("on screen");
	};

	test("the list is never drawn taller than the cap", async ({ page }) => {
		await openAMillion(page);

		const { listHeight } = await listGeometry(page);
		expect(listHeight).toBeLessThanOrEqual(MAX_SCROLL_HEIGHT);
		// Firefox draws an element asked to be taller than its limit at no height at all, which is under
		// any cap and holds nothing to scroll to.
		const viewport = await scroller(page).evaluate(
			(element) => element.clientHeight,
		);
		expect(listHeight).toBeGreaterThan(viewport);
	});

	["compact", "album"].forEach((layout) => {
		test.describe(`in ${layout} layout`, () => {
			test.use({
				settings: { "jean.layout": layout, "jean.followPlayback": false },
			});

			test("the last row is reached by scrolling to the bottom, and the first by scrolling back", async ({
				page,
			}) => {
				await openAMillion(page);

				await scrollUntilTheLastRowIsShown(page);

				await scrollTo(page, 0);
				await settle(page);
				await expectOnScreen(page, 0);
			});

			// The view leaves a room under the list that scrolls one for one; read through the list's own
			// scale, it showed as empty list under the last row. An album's group keeps its own padding
			// under its last row, so what ends with the list is the entry holding the last row.
			test("at the bottom the last row ends where the list ends, with no empty list under it", async ({
				page,
			}) => {
				await openAMillion(page);
				await scrollUntilTheLastRowIsShown(page);

				const { lastEnds, listEnds } = await scroller(page).evaluate(
					(element, last) => {
						const row = element.querySelector(
							`[role="row"][data-row="${last}"]`,
						) as HTMLElement;
						const entry = row.closest('[role="grid"] > *') as HTMLElement;
						const grid = element.querySelector('[role="grid"]') as HTMLElement;
						return {
							lastEnds: entry.getBoundingClientRect().bottom,
							listEnds: grid.getBoundingClientRect().bottom,
						};
					},
					LAST,
				);
				// Two pixels rather than one: the header's height is fractional and the scroller reports
				// whole pixels, and each pixel of scroll is three of list at a million rows.
				expect(
					Math.abs(listEnds - lastEnds),
					`the entry holding the last row ends at ${lastEnds}px and the list at ${listEnds}px`,
				).toBeLessThan(2);
			});

			test("End reaches the last row, and Home the first", async ({ page }) => {
				await openAMillion(page);
				await expect(trackRow(page, 0)).toBeVisible();

				await page.keyboard.press("End");
				await settle(page);
				await expectOnScreen(page, LAST);
				await expect(trackRow(page, LAST)).toHaveAttribute(
					"data-cursor",
					"true",
				);

				await page.keyboard.press("Home");
				await settle(page);
				await expectOnScreen(page, 0);
				await expect(trackRow(page, 0)).toHaveAttribute("data-cursor", "true");
			});

			test("jumping to the playing track reaches it deep in the list and on the last row", async ({
				page,
				player,
			}) => {
				await openAMillion(page);

				await trackRow(page, 0).dblclick();
				await expect
					.poll(() => scratchOf(player)?.items.length ?? 0, {
						timeout: LIBRARY_LANDS_MS,
					})
					.toBe(MILLION);
				const scratch = scratchOf(player)!;
				await expect
					.poll(() => playedFrom(player)?.id, { timeout: LIBRARY_LANDS_MS })
					.toBe(scratch.guid);

				for (const row of [DEEP, LAST]) {
					player.playItem(scratch.id, row);
					const title = scratch.items[row]["%title%"];
					await expect(statusBar(page)).toContainText(title);
					await scrollTo(page, 0);
					await settle(page);

					await page.keyboard.press("n");
					await settle(page);
					await expectOnScreen(page, row);
					await expect(trackRow(page, row)).toHaveAttribute(
						"data-active",
						"true",
					);
					await expect(trackRow(page, row)).toContainText(title);
				}

				player.playItem(scratch.id, DEEP);
				await expect(statusBar(page)).toContainText(
					scratch.items[DEEP]["%title%"],
				);
				await scrollTo(page, 0);
				await settle(page);
				await page.keyboard.press("n");
				await settle(page);
				await expect
					.poll(() => offCentre(page, DEEP), { timeout: SETTLES_MS })
					.toBeLessThan(2);

				await sidebar(page)
					.getByRole("button", { name: /Rock en Español/ })
					.click();
				await expect(
					page.getByRole("heading", { level: 1, name: "Rock en Español" }),
				).toBeVisible();
				await page.keyboard.press("n");
				await expect(
					page.getByRole("heading", { level: 1, name: "All music" }),
				).toBeVisible();
				await settle(page);
				await expect
					.poll(() => offCentre(page, DEEP), { timeout: SETTLES_MS })
					.toBeLessThan(2);
			});
		});
	});

	test("leaving at the last row and coming back to a shorter window lands on the same row", async ({
		page,
	}) => {
		await openAMillion(page);
		await scrollUntilTheLastRowIsShown(page);
		const left = await rowAtTop(page);
		expect(left).not.toBeNull();

		await sidebar(page)
			.getByRole("button", { name: /Rock en Español/ })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await page.setViewportSize({ width: 1280, height: 700 });

		await sidebar(page)
			.getByRole("button", { name: /All music/ })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await settle(page);
		await expect.poll(() => rowAtTop(page), { timeout: SETTLES_MS }).toBe(left);
	});

	test("a wheel scrolls by the browser's own amount", async ({ page }) => {
		await openAMillion(page);
		const box = (await scroller(page).boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		const before = await scrollTop(page);
		await page.mouse.wheel(0, 600);
		await settle(page);
		expect((await scrollTop(page)) - before).toBe(600);
	});

	test.describe("after jumping to the playing track", () => {
		test.use({
			settings: { "jean.layout": "compact", "jean.followPlayback": false },
		});

		const NUDGE_PX = 60;
		const PAGE_ROWS = 12;

		const playDeepAndScrollToTheTop = async (
			page: Page,
			player: Parameters<typeof scratchOf>[0],
		) => {
			await openAMillion(page);
			await trackRow(page, 0).dblclick();
			await expect
				.poll(() => scratchOf(player)?.items.length ?? 0, {
					timeout: LIBRARY_LANDS_MS,
				})
				.toBe(MILLION);
			const scratch = scratchOf(player)!;
			await expect
				.poll(() => playedFrom(player)?.id, { timeout: LIBRARY_LANDS_MS })
				.toBe(scratch.guid);
			player.playItem(scratch.id, DEEP);
			await expect(statusBar(page)).toContainText(
				scratch.items[DEEP]["%title%"],
			);
			await scrollTo(page, 0);
			await settle(page);
		};

		const untilTheJumpLands = (page: Page) =>
			scroller(page).evaluate(
				(element) =>
					new Promise<void>((resolve) => {
						const look = () =>
							element.scrollTop > 0 ? resolve() : requestAnimationFrame(look);
						requestAnimationFrame(look);
					}),
			);

		test("Page Down straight after the jump moves the cursor a page on, and the list stays with it", async ({
			page,
			player,
		}) => {
			await playDeepAndScrollToTheTop(page, player);

			await page.keyboard.press("n");
			await untilTheJumpLands(page);
			await page.keyboard.press("PageDown");
			await settle(page);

			const cursor = DEEP + PAGE_ROWS;
			await expect(trackRow(page, cursor)).toHaveAttribute(
				"data-cursor",
				"true",
			);
			await expectOnScreen(page, cursor);
		});

		// A press on the scrollbar reaches the page as a pointerdown on the scroller, and the drag that
		// follows as nothing but a change of scroll offset.
		test("grabbing the scrollbar straight after the jump leaves the list where the drag put it", async ({
			page,
			player,
		}) => {
			await playDeepAndScrollToTheTop(page, player);

			await page.keyboard.press("n");
			const dragged = await scroller(page).evaluate(
				(element, nudge) =>
					new Promise<number>((resolve) => {
						const look = () => {
							if (element.scrollTop === 0) {
								requestAnimationFrame(look);
								return;
							}
							element.dispatchEvent(
								new PointerEvent("pointerdown", {
									bubbles: true,
									pointerType: "mouse",
								}),
							);
							element.scrollTop += nudge;
							resolve(element.scrollTop);
						};
						requestAnimationFrame(look);
					}),
				NUDGE_PX,
			);
			await settle(page);

			// Chromium holds a scroll offset this large only to every second pixel.
			expect(Math.abs((await scrollTop(page)) - dragged)).toBeLessThanOrEqual(
				2,
			);
		});
	});
});

const LATE = [
	FIELD.codec,
	FIELD.bitrate,
	FIELD.added,
	FIELD.artists,
	FIELD.artistIds,
	FIELD.albumArtists,
	FIELD.albumArtistIds,
].map((field) => TRACK_EXPRESSIONS[field]);
const EARLY = TRACK_EXPRESSIONS.filter((column) => !LATE.includes(column));

const sorted = (columns: readonly string[]) => [...columns].sort();

const releaseTheLatePart = (page: Page) =>
	page.request.post("/__control/holdSubset", { data: {} });

const exportsAsked = (player: Parameters<typeof requestsTo>[0]) =>
	requestsTo(player, "/api/library/export")
		.filter((entry) => entry.method === "GET")
		.map((entry) => new URL(entry.path, "http://fake.invalid").searchParams);

const asksForLateColumns = (query: URLSearchParams) =>
	query.getAll("only").some((column) => LATE.includes(column));

// The resource entries are read through an observer, which sees every entry however full the
// browser's timing buffer is by then.
interface Timeline {
	firstRowAt: number | null;
	exports: { url: string; startTime: number }[];
}

declare global {
	interface Window {
		__timeline: Timeline;
	}
}

const recordTheTimeline = (page: Page) =>
	page.addInitScript(() => {
		const timeline: Timeline = { firstRowAt: null, exports: [] };
		window.__timeline = timeline;
		new MutationObserver(() => {
			if (
				timeline.firstRowAt === null &&
				document.querySelector('[role="row"][data-row]')
			)
				timeline.firstRowAt = performance.now();
		}).observe(document, { subtree: true, childList: true });
		new PerformanceObserver((entries) => {
			for (const entry of entries.getEntries())
				if (new URL(entry.name).pathname === "/api/library/export")
					timeline.exports.push({
						url: entry.name,
						startTime: entry.startTime,
					});
		}).observe({ type: "resource", buffered: true });
	});

const lateExportsSeen = (page: Page) =>
	page.evaluate(
		(late) =>
			window.__timeline.exports.filter((entry) =>
				new URL(entry.url).searchParams
					.getAll("only")
					.some((column) => late.includes(column)),
			),
		LATE,
	);

const holdsAPlaceholder = (cell: Locator) =>
	cell.evaluate((element) =>
		[
			...element.querySelectorAll('[aria-hidden="true"]:not(svg, button *)'),
		].some((bar) => {
			const box = bar.getBoundingClientRect();
			return box.width > 0 && box.height > 0;
		}),
	);

const extentOf = (element: Locator) =>
	element.evaluate((box) => ({
		drawn: box.getBoundingClientRect().height,
		content: box.scrollHeight,
	}));

test.describe("a library that arrives in two parts", () => {
	test.use({ fooJean: { holdSubset: LATE } });

	test("the first part asks for every column but the late set, and the late part for the rest without the spine, after the first rows are drawn", async ({
		page,
		player,
	}) => {
		await recordTheTimeline(page);
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeVisible();

		const firstParts = exportsAsked(player).filter(
			(query) => !asksForLateColumns(query),
		);
		expect(firstParts.length).toBeGreaterThan(0);
		for (const query of firstParts) {
			expect(sorted(query.getAll("only"))).toEqual(sorted(EARLY));
			expect(query.get("spine")).not.toBe("false");
		}

		await expect
			.poll(() => exportsAsked(player).filter(asksForLateColumns).length, {
				message: "Jean never asked for the late part",
			})
			.toBeGreaterThan(0);
		const lateParts = exportsAsked(player).filter(asksForLateColumns);
		expect(lateParts).toHaveLength(1);
		expect(sorted(lateParts[0].getAll("only"))).toEqual(sorted(LATE));
		expect(lateParts[0].get("spine")).toBe("false");
		for (const query of exportsAsked(player))
			expect(query.getAll("columns")).toEqual(TRACK_EXPRESSIONS);

		await releaseTheLatePart(page);
		await expect
			.poll(() => lateExportsSeen(page).then((seen) => seen.length))
			.toBe(1);
		const [late] = await lateExportsSeen(page);
		const { firstRowAt } = await page.evaluate(() => window.__timeline);
		expect(firstRowAt).not.toBeNull();
		expect(late.startTime).toBeGreaterThanOrEqual(firstRowAt as number);
	});

	test.describe("with the late columns shown", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"a phone shows only time, plays and rating, none of them late",
		);
		test.use({ settings: { "jean.columns": ["codec", "bitrate"] } });

		const lateCells = (row: Locator) => {
			const cells = row.getByRole("gridcell");
			return [cells.nth(-2), cells.nth(-1)];
		};

		test("each row draws at once, its late cells holding their place, and is busy until they land at the same height", async ({
			page,
		}) => {
			await page.goto("/#/all");
			const row = trackRow(page, 0);
			await expect(row).toBeVisible();
			const [codec, bitrate] = lateCells(row);

			await expect(row).toHaveAttribute("aria-busy", "true");
			await expect(row.getByRole("gridcell").nth(1)).not.toHaveText("");
			for (const cell of [codec, bitrate]) {
				await expect(cell).toHaveText("");
				expect(await holdsAPlaceholder(cell)).toBe(true);
			}
			const waiting = await Promise.all(
				[row, codec, bitrate].map((box) => extentOf(box)),
			);

			await releaseTheLatePart(page);
			await expect(codec).toHaveText(/^(MP3|FLAC)$/);
			await expect(bitrate).toHaveText(/^\d+$/);
			await expect(row).not.toHaveAttribute("aria-busy", "true");
			expect(
				await Promise.all([row, codec, bitrate].map((box) => extentOf(box))),
			).toEqual(waiting);
		});
	});
});
