import type { Page } from "./fixtures.ts";
import {
	expect,
	FOO_JEAN_TOKEN,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";
import { playRow } from "./nowPlaying.ts";

const wheel = (page: Page) =>
	nowPlayingScreen(page).locator("[data-cover-wheel]");

const detents = (page: Page) =>
	wheel(page).evaluate((el) => {
		const step = Number.parseFloat(
			getComputedStyle(el).getPropertyValue("--step"),
		);
		const turn = Number.parseFloat(el.style.getPropertyValue("--turn"));
		return Number.isFinite(turn) && step ? turn / step : null;
	});

const settled = (page: Page) =>
	nowPlayingScreen(page).evaluate(async (el) => {
		await Promise.all(el.getAnimations().map((entry) => entry.finished));
	});

const across = async (page: Page, from: number, to: number) => {
	await settled(page);
	const box = (await nowPlayingScreen(page).boundingBox())!;
	const y = box.y + box.height * 0.4;
	await touchDrag(
		page,
		{ x: box.x + box.width * from, y },
		{ x: box.x + box.width * to, y },
	);
};

test.describe("the cover wheel", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	test.use({ motion: "allow" });

	test("a flick turns the rim by one sleeve", async ({ page, player }) => {
		await playRow(page, 0);
		expect(await detents(page)).toBe(0);

		await across(page, 0.85, 0.25);
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(-1);

		await across(page, 0.25, 0.85);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(0);
	});

	test("Previous turns the rim back, whoever pressed it", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(1);

		// Reaching the player without going through this screen or `useTransport`,
		// so nothing turned the wheel and all it is told is that a track changed.
		// The player never says which way it moved, so the direction is read off
		// what was asked of it.
		await page.keyboard.press("ControlOrMeta+ArrowRight");
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(0);

		await page.keyboard.press("ControlOrMeta+ArrowLeft");
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(1);
	});

	test("a track ending by itself goes forward, not back", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		// A skip that was asked for and never answered must not leave its
		// direction lying around for the next track that ends of its own
		// accord to pick up.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => detents(page)).toBe(1);

		player.next();
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(0);
	});

	test("the sleeve is still there after the screen has been dismissed and reopened", async ({
		page,
	}) => {
		await playRow(page, 0);
		await settled(page);
		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await openNowPlaying(page);

		await expect.poll(() => detents(page)).toBe(-1);
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		const box = (await current.locator("img").boundingBox())!;
		const screen = (await nowPlayingScreen(page).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(screen.x - 1);
		expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
	});

	test("a drag that does not get far enough springs back and skips nothing", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		await across(page, 0.5, 0.44);
		await expect.poll(() => detents(page)).toBe(0);
		expect(player.player.activeItem.index).toBe(0);
	});

	test("every slot holds the same way, sleeve or no sleeve", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		await expect(wheel(page).locator("[data-artwork]")).toHaveCount(3);
		await expect(
			wheel(page).locator('[data-artwork="waiting"]').first(),
		).toBeVisible();
	});

	test("what it turns to is a hold, where the next sleeve cannot be known", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		const current = wheel(page).locator("[data-current]");
		await expect(current.locator(".loading")).toBeVisible();
		await expect(nowPlayingScreen(page).locator("h1")).not.toHaveText(
			"Nothing playing",
		);

		await expect(current.locator("img")).toBeVisible();
		expect(await detents(page)).toBe(-1);
	});

	test("under Default it turns straight onto the next sleeve, with no hold at all", async ({
		page,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		await expect(current.locator(".loading")).toHaveCount(0);
	});

	test("a turn nothing answers is put back", async ({ page, player }) => {
		await openLibrary(page);
		await page.request.post("/__control/play", {
			data: { playlistId: "p1", index: 3 },
		});
		await expect.poll(() => player.player.activeItem.index).toBe(3);
		await openNowPlaying(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });

		await expect(nowPlayingScreen(page).locator("h1")).not.toHaveText(
			"Nothing playing",
		);

		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await expect.poll(() => detents(page), { timeout: 10_000 }).toBe(0);
		expect(player.player.activeItem.index).toBe(3);
	});
});

test.describe("the wheel while the sound is a stream", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	// Six seconds of lag, which is longer than the wheel waits before putting an unanswered turn back.
	test.use({
		motion: "allow",
		fooJean: { streamPrime: 6 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});
	test.setTimeout(120_000);

	test("holds the identity until the sound arrives, and never pairs it with the wrong sleeve", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);
		await openNowPlaying(page);

		const title = nowPlayingScreen(page).locator("h1");
		const leaving = await title.textContent();

		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await expect(title).not.toHaveText(String(leaving));
		await expect(nowPlayingScreen(page).locator("h1.loading")).toBeVisible();

		await page.waitForTimeout(6000);
		expect(await detents(page)).toBe(-1);

		await expect(title).not.toHaveText(String(leaving), { timeout: 60_000 });
		await expect(nowPlayingScreen(page).locator("h1.loading")).toHaveCount(0, {
			timeout: 60_000,
		});
	});
});

test.describe("the wheel where motion is refused", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);

	test("does not turn, and swaps the sleeve instead", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		await across(page, 0.85, 0.25);

		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect(wheel(page)).toHaveCSS("transform", "none");
		await expect(wheel(page).locator("[data-current]")).toHaveCSS(
			"opacity",
			"1",
		);
	});
});
