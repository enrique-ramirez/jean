import type { Page } from "./fixtures.ts";
import { expect, nowPlayingScreen, test } from "./fixtures.ts";
import { playRow, TAGGED } from "./nowPlaying.ts";

// Row 5 is El Loco, tagged with a synced lyric long enough to scroll.
const LONG_SYNCED_ROW = 5;

const scrollScreenTo = (page: Page, top: number) =>
	nowPlayingScreen(page).evaluate((screen, to) => {
		screen.scrollTop = to;
	}, top);

const boxOf = async (locator: ReturnType<Page["locator"]>) => {
	const box = await locator.boundingBox();
	if (!box) throw new Error("not on screen");
	return box;
};

test.describe("the gatefold", () => {
	test.use(TAGGED);
	test.skip(
		({ isMobile }) => isMobile,
		"a phone's screen does not scroll as one",
	);

	test.describe("wide enough for the sleeve to stand beside the lyric", () => {
		test.use({ viewport: { width: 1600, height: 900 } });

		test("scrolling moves the lyric and nothing above it", async ({ page }) => {
			await playRow(page, LONG_SYNCED_ROW);
			const screen = nowPlayingScreen(page);
			const dismiss = screen.getByRole("button", { name: "Close now playing" });
			const title = screen.getByRole("heading", { level: 1 });
			const tab = screen.getByRole("button", { name: "Lyrics", exact: true });

			const rested = {
				dismiss: (await boxOf(dismiss)).y,
				title: (await boxOf(title)).y,
				tab: (await boxOf(tab)).y,
			};

			await scrollScreenTo(page, 400);
			await expect
				.poll(() => screen.evaluate((element) => element.scrollTop))
				.toBeGreaterThan(0);

			expect((await boxOf(dismiss)).y).toBe(rested.dismiss);
			expect((await boxOf(title)).y).toBe(rested.title);
			expect((await boxOf(tab)).y).toBe(rested.tab);
		});
	});

	test("the resume pill is within reach however far back up the lyric is", async ({
		page,
	}) => {
		await playRow(page, LONG_SYNCED_ROW);
		const screen = nowPlayingScreen(page);
		const pill = screen.getByRole("button", { name: "Resume following" });

		await scrollScreenTo(page, 600);
		await expect(pill).toBeVisible();

		await scrollScreenTo(page, 0);
		const frame = await boxOf(screen);
		const box = await boxOf(pill);
		expect(box.y).toBeGreaterThanOrEqual(frame.y);
		expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);

		await pill.click();
		await expect(pill).toBeHidden();
	});

	test("the full-screen button clears the strip's rule", async ({ page }) => {
		await playRow(page, LONG_SYNCED_ROW);
		const screen = nowPlayingScreen(page);
		const strip = await boxOf(
			screen.getByRole("navigation", { name: "Track views" }),
		);
		const expand = await boxOf(
			screen.getByRole("button", { name: "Full-screen lyrics" }),
		);

		expect(
			strip.y + strip.height - (expand.y + expand.height),
		).toBeGreaterThanOrEqual(8);
	});
});
