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

// Apple's Human Interface Guidelines put a touch target's least side at 44 points. Under a coarse
// pointer every control reaches it, drawn that size or given a hit area around its glyph.
const TOUCH_TARGET = 44;

const INTRODUCTIONS_DISMISSED = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

const HIT_TEST_STEP = 0.5;

const tapExtent = (control: Locator) =>
	control.evaluate(
		(element, { reach, step }) => {
			const box = element.getBoundingClientRect();
			const centre = {
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
			};
			const reaches = (x: number, y: number) => {
				const hit = document.elementFromPoint(x, y);
				return hit !== null && element.contains(hit);
			};
			const span = (at: (offset: number) => boolean) => {
				let out = 0;
				while (out + step <= reach && at(out + step)) out += step;
				return out;
			};
			return {
				width:
					step +
					span((d) => reaches(centre.x - d, centre.y)) +
					span((d) => reaches(centre.x + d, centre.y)),
				height:
					step +
					span((d) => reaches(centre.x, centre.y - d)) +
					span((d) => reaches(centre.x, centre.y + d)),
			};
		},
		{ reach: TOUCH_TARGET, step: HIT_TEST_STEP },
	);

// Chromium hit-tests at device pixels, 1/2.625 of a CSS pixel on the Pixel 7, so an edge can read
// up to half a pixel short of where it is drawn.
const ROUNDING = 0.5;

const expectTapTarget = async (control: Locator, name: string) => {
	await expect(control, name).toBeVisible();
	const { width, height } = await tapExtent(control);
	expect(width, `${name} reaches ${width} px across`).toBeGreaterThanOrEqual(
		TOUCH_TARGET - ROUNDING,
	);
	expect(height, `${name} reaches ${height} px tall`).toBeGreaterThanOrEqual(
		TOUCH_TARGET - ROUNDING,
	);
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

	test("the library toolbar: the heat switch, the layout options, view options and a genre chip", async ({
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
		await expectTapTarget(
			page.getByRole("link", { name: /%$/ }).first(),
			"a genre chip",
		);
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
