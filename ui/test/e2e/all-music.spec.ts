import { en } from "../../src/shared/i18n/en.ts";
import { compareText, pathKey } from "../fake-api/playerOrder.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	openSidebar,
	playedFrom,
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

// Written out rather than imported from the implementation, so a change to the cap has to come
// through here too. Firefox's own limit is the one it leaves room under.
const MAX_SCROLL_HEIGHT = 15_000_000;

const scroller = (page: Page) => page.locator("main");

// Capped, so a list that never comes to rest fails on the assertion that follows, which says where
// it was, rather than on the test's timeout.
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

// The row the scroller's top edge passes through, or null where the header sits there instead.
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

// Under the cap, one pixel of scroll is one pixel of list, so a row deep in a library this size
// sits exactly where it always did.
test.describe("a library under the scroll cap", () => {
	test.use({ mediaLibrarySize: 30441 });

	test("scrolls as it always has: the list is as tall as its rows, and a scroll offset lands on the same row", async ({
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

		// Deep enough that a scale a hair off one moves the row by more than its own height.
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
// Each case builds the library afresh, since the fixture resets the player per test.
const MILLION = 1_000_000;
const LAST = MILLION - 1;
// Past where an unscaled list stops in every engine.
const DEEP = 800_000;
// Generous, since several workers each building and decoding a million tracks share one machine.
const MILLION_MS = 10 * 60_000;
const LIBRARY_LANDS_MS = 6 * 60_000;
const SETTLES_MS = 60_000;

test.describe("a library of a million tracks", { tag: "@firefox" }, () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the height limit is the engine's, which this project shares with desktop; a fling over the cap is checked by hand on a phone",
	);
	test.setTimeout(MILLION_MS);

	// The cardinalities `pnpm fake --tracks` builds, so a profile and these cases see one shape.
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

	// A sentence rather than a boolean, so a failure says where the list stopped.
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

	// Asked again until it holds, as a person drags the thumb down again: the header above the list
	// can still be growing when the first ask lands, and a list that cannot reach its end never
	// shows the row however often it is asked.
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

	// The list's own height: the header above it is drawn at its real height and is not counted.
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

			// Scrolled the way dragging the thumb to the bottom of the track does: the scroll offset set
			// straight to its end, with no wheel event and no listener in between.
			test("the last row is reached by scrolling to the bottom, and the first by scrolling back", async ({
				page,
			}) => {
				await openAMillion(page);

				await scrollUntilTheLastRowIsShown(page);

				await scrollTo(page, 0);
				await settle(page);
				await expectOnScreen(page, 0);
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

			// Deep in the list as well as at its end: the end is where an offset left unmapped and clamped
			// to the scroller's own bottom lands by accident.
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
				// The app's own play of the clicked row lands after the fill, and would replace the ones below.
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

				// Centred, as `n` centres anywhere the list has room on both sides; the last row has none.
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

				// From another view, `n` opens All music already at the track rather than scrolling to it.
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

	// Remembered as a place in the list rather than as a scroll offset: over the cap one scroll pixel is
	// several pixels of list, and how many depends on the scroller's height, so an offset kept across a
	// resize comes back rows away from where it was left.
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

	// The browser's own scroll, so a wheel moves the scroll offset by what the wheel
	// said and nothing turns it into a smaller step or swallows it.
	test("a wheel scrolls by the browser's own amount", async ({ page }) => {
		await openAMillion(page);
		const box = (await scroller(page).boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		const before = await scrollTop(page);
		await page.mouse.wheel(0, 600);
		await settle(page);
		expect((await scrollTop(page)) - before).toBe(600);
	});
});
