import type { Page } from "./fixtures.ts";
import {
	expect,
	isRowOnScreen,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	scrollTo,
	scrollTop,
	scrollUntilMounted,
	statusBar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";
import { playRow, trackInfo } from "./nowPlaying.ts";

test.describe("the way in and the way out", () => {
	test("the status bar block opens it and the chevron closes it", async ({
		page,
	}) => {
		await openLibrary(page);

		await statusBar(page)
			.getByRole("button", { name: "Show current track" })
			.click();
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("Escape closes it, and leaves a selection behind it alone", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await openLibrary(page);
		await trackRow(page, 1).click();
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");

		await openNowPlaying(page);
		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();

		// Escape also clears a selection in the list, which is why this one is
		// taken on the way down and stopped: two meanings, one keystroke.
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");
	});

	test("a field keeps Escape while the screen is open", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the top bar is behind the screen on a phone");

		await openLibrary(page);
		await openNowPlaying(page);

		// Empty rather than typed at: a query gives the field its own dropdown, and
		// Escape would close that instead of reaching the screen.
		const field = page.getByLabel("Search your library");
		await field.focus();
		await field.press("Escape");

		// Leaving a field is the same key, and the screen must not reach over a
		// caret to take it. The hash rather than the element, since dismissing
		// navigates at once but takes the exit animation to leave.
		await expect(field).not.toBeFocused();
		await expect(page).toHaveURL(/#\/playing$/);
	});

	test("the track menu takes Escape before the screen does", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await playRow(page, 0);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Track actions" })
			.click();
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("a reload lands on it and leaving still goes somewhere", async ({
		page,
	}) => {
		// `history.back()` would leave Jean altogether here: a direct load has no
		// entry behind it.
		await page.goto("/#/playing");
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(page.locator("main")).toBeVisible();
	});
});

test.describe("the set it is playing from", () => {
	test("the header takes you back to it, and closes on the way", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Playing from/ })
			.click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test.describe("it lands on the track, not at the top of the set", () => {
		test.use({
			mediaLibrarySize: 400,
			librarySize: 400,
			settings: { "jean.followPlayback": false },
		});

		// Far enough down a 400-track library to be nowhere near the fold.
		const FAR = 120;

		const playFarAndLeaveTheTop = async (page: Page) => {
			await page.goto("/#/all");
			await expect(
				page.getByRole("heading", { level: 1, name: "All music" }),
			).toBeVisible();
			await scrollUntilMounted(page, trackRow(page, FAR));
			await trackRow(page, FAR).dblclick();
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");

			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);
		};

		const openThePlayingSet = async (page: Page) => {
			await openNowPlaying(page);
			await nowPlayingScreen(page)
				.getByRole("button", { name: /Playing from/ })
				.click();
			await expect(nowPlayingScreen(page)).toBeHidden();
		};

		test("from another view", async ({ page }) => {
			await playFarAndLeaveTheTop(page);
			await page.goto("/#/p5");
			await expect(page.getByRole("grid")).toBeVisible();

			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");
		});

		test("and from the set it is already showing", async ({ page }) => {
			await playFarAndLeaveTheTop(page);

			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
		});
	});

	test("it is a line and not a button when the set has nowhere to open", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		const header = nowPlayingScreen(page).locator("header");
		await expect(header).toContainText("Now playing");
		await expect(
			header.getByRole("button", { name: /Playing from/ }),
		).toHaveCount(0);
	});
});

test.describe("the screen a phone gets", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold is a pane inside the shell, which is the point of it",
	);

	test("is the whole viewport, the app chrome included", async ({ page }) => {
		await openLibrary(page);
		await openNowPlaying(page);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const view = page.viewportSize()!;
		expect(box.y, "the screen starts below the top bar").toBe(0);
		expect(box.height).toBeGreaterThanOrEqual(view.height);
	});

	test("Play is lifted off the bottom edge where there is height to spare", async ({
		page,
	}) => {
		await playRow(page, 0);

		const play = nowPlayingScreen(page).getByRole("button", {
			name: /^(Play|Pause)$/,
		});
		const clearance = async () => {
			const box = (await play.boundingBox())!;
			return page.viewportSize()!.height - (box.y + box.height);
		};

		const tall = await clearance();

		// Polled: the box reads back before the media query the resize crossed has
		// relaid the screen out.
		await page.setViewportSize({ width: 375, height: 667 });
		await expect
			.poll(clearance, {
				message: "a phone this short keeps its pixels for the artwork",
			})
			.toBeLessThan(tall);

		expect(
			await clearance(),
			"and the transport is never pushed off the edge",
		).toBeGreaterThan(0);
	});

	test("Play is in the middle of the row, whatever flanks it", async ({
		page,
	}) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		const play = (await screen
			.getByRole("button", { name: /^(Play|Pause)$/ })
			.boundingBox())!;
		// The screen's padding is symmetrical, so the middle of the row is the
		// middle of the viewport.
		const view = page.viewportSize()!;
		const centre = play.x + play.width / 2;
		expect(
			Math.abs(centre - view.width / 2),
			`Play is centred at ${Math.round(centre)}px of ${view.width}px`,
		).toBeLessThanOrEqual(1);
	});
});

test.describe("a control that follows the finger keeps the gesture", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the transport is compact-only, and this is touch",
	);

	test("the fader can be dragged down without dismissing the screen", async ({
		page,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await screen.getByRole("button", { name: "Show volume" }).click();
		const fader = page.getByRole("slider", { name: /Volume/ });
		const box = (await fader.boundingBox())!;
		const x = box.x + box.width / 2;

		// Well past the 60px a flick has to travel, downwards, which is the
		// gesture that dismisses the screen everywhere else on it.
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.15 },
			{ x, y: box.y + box.height * 0.85 },
		);

		await expect(page).toHaveURL(/#\/playing$/);
		await expect(screen).toBeVisible();

		const landed = Number(await fader.getAttribute("aria-valuenow"));
		expect(landed, `fader landed at ${landed}%, aimed at 15%`).toBeLessThan(40);
	});

	test("the seek bar can be scrubbed without skipping the track", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);
		const playing = player.player.activeItem.index;

		const bar = screen.getByRole("slider", { name: "Playback position" });
		const box = (await bar.boundingBox())!;
		const y = box.y + box.height / 2;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.75, y },
			{ x: box.x + box.width * 0.2, y },
		);

		expect(player.player.activeItem.index).toBe(playing);
		await expect
			.poll(() =>
				requestsTo(player, "/api/player").filter(
					(entry) => entry.body?.position !== undefined,
				),
			)
			.toHaveLength(1);
	});
});

test.describe("skipping with a flick", () => {
	test.skip(({ isMobile }) => !isMobile, "this is the touch gesture");

	const flick = async (page: Page, from: number, to: number) => {
		const box = (await nowPlayingScreen(page).boundingBox())!;
		const y = box.y + box.height * 0.4;
		await touchDrag(
			page,
			{ x: box.x + box.width * from, y },
			{ x: box.x + box.width * to, y },
		);
	};

	test("leftwards is the next track and rightwards is the one before", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await expect.poll(() => player.player.activeItem.index).toBe(0);

		await flick(page, 0.8, 0.2);
		await expect.poll(() => player.player.activeItem.index).toBe(1);

		await flick(page, 0.2, 0.8);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
	});

	test("upwards opens the panels, and the screen stays where it was", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.5 },
			{ x, y: box.y + box.height * 0.5 - 120 },
		);

		await expect(trackInfo(page)).toBeVisible();
		expect(player.player.activeItem.index).toBe(0);
		await expect(page).toHaveURL(/#\/playing$/);
	});
});

test.describe("the gap a skip leaves", () => {
	// See ../../src/shared/api/README.md for what foobar2000 does during a skip and why.

	const watchTitles = (page: Page) =>
		page.evaluate(() => {
			const screen = document.querySelector("[data-now-playing]");
			if (!screen) throw new Error("the now playing screen is not mounted");

			const seen: string[] = [];
			const record = () => {
				const title = screen.querySelector("h1")?.textContent ?? "";
				if (title && title !== seen[seen.length - 1]) seen.push(title);
			};

			record();
			new MutationObserver(record).observe(screen, {
				subtree: true,
				childList: true,
				characterData: true,
			});
			Object.assign(window, { __titles: seen });
		});

	const titlesSeen = (page: Page) =>
		page.evaluate(() => (window as { __titles?: string[] }).__titles ?? []);

	test("the screen holds the track it has rather than emptying", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipGap", { data: { ms: 300 } });
		await watchTitles(page);

		// The skip is asked of the player rather than pressed: the transport is on the screen on a phone and in the
		// status bar on a desktop, and the gap is the same push either way.
		player.next();
		await expect.poll(() => player.player.activeItem.index).toBe(1);

		const titles = await titlesSeen(page);
		expect(titles).not.toContain("Nothing playing");
		expect(titles).toHaveLength(2);
	});

	test("a real stop still says nothing is playing", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await watchTitles(page);

		player.stop();

		await expect(nowPlayingScreen(page).locator("h1")).toHaveText(
			"Nothing playing",
		);
	});

	test("the header keeps the set it is playing from", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		const header = nowPlayingScreen(page).locator("header");
		await expect(header).toContainText("Playing from");

		await page.request.post("/__control/skipGap", { data: { ms: 300 } });
		await watchTitles(page);
		player.next();

		await expect(header).toContainText("Playing from");
		expect(await titlesSeen(page)).not.toContain("Nothing playing");
	});
});
