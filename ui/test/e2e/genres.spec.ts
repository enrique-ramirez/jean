import { GENRE_EXPRESSION } from "../../src/shared/api/multiValue.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	openSidebar,
	requestsTo,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";
import { openPanels, panelTab, playRow } from "./nowPlaying.ts";

// The fake library carries five genres, one of them accented and two of them two
// words. Enough to tell ranking from filtering.
const finder = (page: Page) =>
	page.getByRole("textbox", { name: "Find a genre" });

const tile = (page: Page, name: string | RegExp) =>
	page.getByRole("link", { name });

const tiles = (page: Page) => page.locator("[data-genre-tile]");

const openGenres = async (page: Page) => {
	await page.goto("/#/genres");
	await expect(tiles(page).first()).toBeVisible();
};

test.describe("the genres index", () => {
	test("it lists every genre in the library, with its figures", async ({
		page,
	}) => {
		await openGenres(page);

		await expect(
			page.getByRole("heading", { level: 1, name: "Genres" }),
		).toBeVisible();
		await expect(tiles(page)).toHaveCount(5);
		await expect(tile(page, /Post Rock/)).toContainText("13 tracks");
	});

	test("the figure on a tile is the number of rows behind it", async ({
		page,
	}) => {
		await openGenres(page);
		await tile(page, /Post Rock/).click();

		// The tile counts through `tagKey` and `refsOfGenre` matches through
		// `tagKey`, and this is the assertion that keeps the two honest.
		await expect(viewHeader(page)).toContainText("13");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
	});

	test.describe("finding one", () => {
		test("an unaccented query finds the accented tag", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("rock en espanol");
			await expect(tiles(page)).toHaveCount(1);
			await expect(tiles(page).first()).toContainText("Rock En Español");
		});

		test("separators are not part of the name", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("postrock");
			await expect(tiles(page).first()).toContainText("Post Rock");
		});

		test("a typo still finds it", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("altenative rock");
			await expect(tiles(page).first()).toContainText("Alternative Rock");
		});

		test("it says so when nothing matches, rather than showing an empty grid", async ({
			page,
		}) => {
			await openGenres(page);
			await finder(page).fill("zzzzqqqq");
			await expect(tiles(page)).toHaveCount(0);
			await expect(page.getByText(/No genre here answers/)).toBeVisible();
		});

		test("`/` puts the caret in the field", async ({ page }) => {
			await openGenres(page);
			await page.keyboard.press("/");
			await expect(finder(page)).toBeFocused();
			// The binding must not also type itself into the field it opened.
			await expect(finder(page)).toHaveValue("");
		});

		test("Enter opens the best match", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("grun");
			await finder(page).press("Enter");
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				"Grunge",
			);
		});
	});

	test.describe("the keyboard on the grid", () => {
		test("Space opens the focused genre and leaves the music alone", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await tiles(page).first().focus();
			await page.keyboard.press(" ");

			await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
				"Genres",
			);
			// The whole point: Space is the player's play/pause everywhere else, and a
			// tile that opened a genre *and* paused the music is doing two things.
			await expect.poll(() => player.player.playbackState).toBe("playing");
		});

		test("the arrows walk the grid and leave the track where it was", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await tiles(page).first().focus();
			await page.keyboard.press("ArrowRight");
			await expect(tiles(page).nth(1)).toBeFocused();

			await page.keyboard.press("ArrowLeft");
			await expect(tiles(page).first()).toBeFocused();

			// The same trap as Space: left and right seek five seconds everywhere else,
			// and a grid you can walk must not scrub the track under you.
			expect(
				requestsTo(player, "/api/playback/seek").filter(
					(entry) => entry.body?.relativeSeconds !== undefined,
				),
			).toHaveLength(0);
		});

		test("play/pause still works on this page when no tile has the caret", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await page.locator("main").click({ position: { x: 5, y: 5 } });
			await page.keyboard.press(" ");

			await expect.poll(() => player.player.playbackState).toBe("paused");
		});
	});
});

test.describe("the ways in", () => {
	test("the sidebar carries a Genres row under All music", async ({ page }) => {
		await page.goto("/");
		await openSidebar(page);

		const labels = await sidebar(page).getByRole("button").allInnerTexts();
		const all = labels.findIndex((entry) => entry.startsWith("All music"));
		const genres = labels.findIndex((entry) => entry.startsWith("Genres"));

		expect(genres).toBe(all + 1);
	});

	test("All music's chips open a genre, and the last one opens the index", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.goto("/#/all");

		await expect(
			viewHeader(page).getByRole("link", { name: /All genres/ }),
		).toHaveAttribute("href", "#/genres");

		await viewHeader(page)
			.getByRole("link", { name: /Post Rock/ })
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
	});

	test("a genre view carries the way back to the index", async ({ page }) => {
		await openGenres(page);
		await tile(page, /Grunge/).click();

		await viewHeader(page)
			.getByRole("link", { name: /All genres/ })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Genres" }),
		).toBeVisible();
	});
});

test.describe("a track tagged with several genres", () => {
	test.use({
		retagged: {
			"Los Calientes": {
				"%genre%": "Rock En Español, Latin Rock",
				[GENRE_EXPRESSION]: "Rock En Español\u001fLatin Rock",
			},
		},
	});

	test("it counts in each genre, and no tile names two", async ({ page }) => {
		await openGenres(page);

		await expect(tiles(page)).toHaveCount(6);
		await expect(tile(page, /Rock En Español/)).toContainText("12 tracks");
		await expect(tile(page, /Latin Rock/)).toContainText("1 track");
		await expect(tiles(page).filter({ hasText: "," })).toHaveCount(0);

		await tile(page, /Latin Rock/).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Latin Rock",
		);
		await expect(viewHeader(page)).toContainText("1 track");
	});

	test("Details links each genre on its own", async ({ page, isMobile }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Details").click();

		await expect(
			panel.getByRole("link", { name: "Rock En Español", exact: true }),
		).toBeVisible();
		await panel.getByRole("link", { name: "Latin Rock", exact: true }).click();
		await expect(page).toHaveURL(/#\/genre\/Latin%20Rock$/);
	});
});
