import type { Locator, Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	statusBar,
	test,
	toastRegion,
	trackRow,
	viewHeader,
} from "./fixtures.ts";
import { pressAndHold } from "./gestures.ts";
import { expectTapTarget } from "./tapping.ts";

const INTRODUCTIONS_DISMISSED = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

const button = (scope: Locator | Page, name: string) =>
	scope.getByRole("button", { name, exact: true });

test.describe("under a coarse pointer, a control reaches 44 px", () => {
	test.skip(({ isMobile }) => !isMobile, "the desktop project has a mouse");
	test.use({ settings: INTRODUCTIONS_DISMISSED });

	test("the top bar's icons, brand and place", async ({ page }) => {
		await openLibrary(page);
		for (const name of ["Show playlists", "Search your library", "Settings"])
			await expectTapTarget(button(page, name), name);
		await expectTapTarget(
			page.getByRole("link", { name: "jean" }),
			"the brand",
		);
		await expectTapTarget(
			button(page.locator("header").first(), "Library"),
			"the place",
		);
	});

	test("the view header's Play, Shuffle and Sort, and the toolbar's Find", async ({
		page,
	}) => {
		await openLibrary(page);
		for (const name of ["Play", "Shuffle"])
			await expectTapTarget(button(viewHeader(page), name), name);
		await expectTapTarget(
			viewHeader(page).getByRole("button", { name: /^Sort/ }),
			"Sort",
		);
		await expectTapTarget(
			page.getByRole("button", { name: /^Find in this playlist/ }),
			"Find in this playlist",
		);
	});

	test("the drawer's rows and New playlist", async ({ page }) => {
		await openLibrary(page);
		await button(page, "Show playlists").tap();
		const rows = page.locator("[data-nav-row]");
		await expect(rows.first()).toBeVisible();
		await expectTapTarget(rows.nth(0), "the first drawer row");
		await expectTapTarget(rows.nth(4), "a playlist row");
		await expectTapTarget(button(page, "New playlist"), "New playlist");
	});

	test("the library toolbar: the heat switch, the layout options and view options", async ({
		page,
	}) => {
		await openLibrary(page);
		for (const name of [
			"Show play-count heat",
			"List",
			"Albums",
			"View options",
		])
			await expectTapTarget(button(page, name), name);
	});

	test("Home's Explore link and shelf tabs", async ({ page }) => {
		await page.goto("/");
		await expectTapTarget(
			page.getByRole("link", { name: "Explore" }),
			"Explore",
		);
		await expectTapTarget(button(page, "Most played"), "the Most played tab");
	});

	test("the genre finder", async ({ page }) => {
		await page.goto("/#/genres");
		await expectTapTarget(page.getByLabel("Find a genre"), "Find a genre");
	});

	test("the status bar's play, output and volume controls", async ({
		page,
		player,
	}) => {
		player.playItem("p7", 2);
		await openLibrary(page);
		const bar = statusBar(page);
		for (const name of ["Pause", "Choose where to play", "Show volume"])
			await expectTapTarget(button(bar, name), name);
	});

	test("Now Playing's close, actions, Lyrics, seek bar, output and volume controls", async ({
		page,
		player,
	}) => {
		player.playItem("p7", 2);
		await openLibrary(page);
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);
		await expectTapTarget(
			screen.getByRole("slider", { name: "Playback position" }),
			"the seek bar",
		);
		for (const name of [
			"Close now playing",
			"Track actions",
			"Lyrics",
			"Choose where to play",
			"Show volume",
		])
			await expectTapTarget(button(screen, name), name);
	});

	test("a help hint in Settings", async ({ page }) => {
		await openSettings(page);
		await expectTapTarget(
			button(page.getByRole("dialog"), "About the write allowlist"),
			"the write allowlist's help hint",
		);
	});

	test("a toast's Dismiss", async ({ page, player }) => {
		player.fooJean.failQueue = 500;
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 0));
		await page.getByRole("menuitem", { name: /^Add to queue/ }).tap();
		await expect(toastRegion(page)).toContainText(
			"The player would not change the queue.",
		);
		await expectTapTarget(button(page, "Dismiss"), "Dismiss");
	});
});
