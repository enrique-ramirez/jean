import type { Page } from "./fixtures.ts";
import {
	expect,
	FOO_JEAN_TOKEN,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";
import {
	openPanels,
	panelTab,
	playRow,
	TAGGED,
	writeLyric,
} from "./nowPlaying.ts";

test.describe("reading the lyric tag", () => {
	test.use(TAGGED);

	test("a timed lyric is followable, and every line is a seek target", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		const line = panel.getByRole("button", {
			name: "Dancing in the dark",
		});
		await expect(line).toBeVisible();

		await line.click();
		await expect
			.poll(() =>
				requestsTo(player, "/api/player").flatMap((entry) =>
					entry.body && "position" in entry.body ? [entry.body.position] : [],
				),
			)
			.toContain(24);
	});

	test("one line with two timestamps is two lines", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(
			panel.getByRole("button", { name: "Give you all my time" }),
		).toHaveCount(2);
	});

	test("an untimed lyric says so rather than looking like broken sync", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 1);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(panel).toContainText("Unsynced");
		await expect(panel).toContainText("Wait a minute, let me finish");
		// Not seekable, because there is nothing to seek to.
		await expect(
			panel.getByRole("button", { name: "Wait a minute, let me finish" }),
		).toHaveCount(0);
	});

	test("timestamps that never leave the opening bars are not sync", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 2);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		// Three timestamps, so a count threshold would call this synced; they span
		// five seconds of a four-minute track.
		await expect(panel).toContainText("Unsynced");
		await expect(panel).toContainText("纯音乐，请欣赏");
		await expect(panel).not.toContainText("[00:00.00]");
	});

	test("no tag is a state rather than an explanation", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(panel).toContainText("No lyrics found");
		await expect(panel).not.toContainText("foo_openlyrics");
	});

	// The reason the panel looks again at all: a search that lands after the track
	// started would otherwise show nothing until the next time it is played.
	test("a lyric written mid-track arrives without a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		writeLyric(player, "Searched for, and found");

		await expect(panel).toContainText("Searched for, and found", {
			timeout: 15_000,
		});
	});
});

test.describe("a lyric read through the stream", () => {
	// Kept out of `TAGGED`: a component also makes the rating control writable,
	// which changes the screen the slim-strip tests measure. Six seconds of lag;
	// the default leaves none. See `test/README.md`.
	test.use({
		...TAGGED,
		fooJean: { streamPrime: 6 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});
	test.setTimeout(120_000);

	// Past the last line for the player, still on the refrain for the ear. The
	// two are eighteen seconds apart, so any lag up to that lands on the same
	// line.
	const PAST_THE_END = 80.5;

	test("follows the player when nothing is listening", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		player.patchPlayer({ position: PAST_THE_END });

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel.locator('[data-state="active"]')).toHaveText(
			"And I don't mind",
		);
	});

	test("a clicked line answers at once, before the audio reaches it", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		const active = panel.locator('[data-state="active"]');

		// Played to, not seeked to: this is the setup.
		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		// Backwards is the case that matters: a position counting on from a stale
		// mark reaches any later line by simply playing, so a forward seek passes
		// either way. The component marks a seek as it marks a track change, so
		// the timeline says where the stream jumped to.
		await panel.getByRole("button", { name: "I never meant to" }).click();

		// Well inside the fake's six-second lag: the audio has not arrived and the
		// control still has to hold where it was put.
		await expect(active).toHaveText("I never meant to", { timeout: 2500 });
	});
});

test.describe("full-screen lyrics", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => isMobile,
		"a phone's Lyrics layer is already full screen, so there is nothing to expand",
	);

	const expand = (page: Page) =>
		page.getByRole("button", { name: "Full-screen lyrics" });
	const close = (page: Page) =>
		page.getByRole("button", { name: "Close full-screen lyrics" });

	test("it is offered on the Lyrics tab and nowhere else", async ({ page }) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);
		await panelTab(panel, "Lyrics").click();
		await expect(expand(page)).toBeVisible();

		await panelTab(panel, "Details").click();
		await expect(expand(page)).toHaveCount(0);
	});

	test("it is not offered when there is no lyric to expand", async ({
		page,
	}) => {
		await playRow(page, 3);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(expand(page)).toHaveCount(0);
	});

	test("only the lyrics are left, and the X brings the screen back", async ({
		page,
	}) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expand(page).click();

		// Scoped to the full-screen region: the panel behind it does not hold a
		// second copy of the lyric.
		const full = page.getByRole("region", { name: "Lyrics" });
		await expect(
			full.getByRole("button", { name: "Dancing in the dark" }),
		).toBeVisible();
		await expect(
			nowPlayingScreen(page).getByRole("button", {
				name: "Dancing in the dark",
			}),
		).toHaveCount(0);
		// Everything else is covered rather than removed, so this is geometry
		// rather than visibility. Every other layer in Jean sits inside `.body`,
		// which starts below the top bar.
		const box = await full.boundingBox();
		const view = page.viewportSize();
		expect(box).toBeTruthy();
		expect(view).toBeTruthy();
		expect(box?.x).toBe(0);
		expect(box?.y).toBe(0);
		expect(box?.width).toBe(view?.width);
		expect(box?.height).toBe(view?.height);

		await close(page).click();
		await expect(close(page)).toHaveCount(0);
		await expect(panelTab(nowPlayingScreen(page), "Details")).toBeVisible();
	});

	test("Escape closes it, and closes only it", async ({ page }) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expand(page).click();
		await expect(close(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(close(page)).toHaveCount(0);
		await expect(nowPlayingScreen(page)).toBeVisible();
	});
});
