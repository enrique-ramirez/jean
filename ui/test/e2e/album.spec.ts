import {
	albumLabel,
	SCRATCH_KIND,
	scratchTitle,
} from "../../src/domain/track/jeanPlaylists.ts";
import { albumRoute } from "../../src/domain/track/routes.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	scratchOf,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

const ARTIST = "Babasónicos";
const ALBUM = "Jessico";
const ROUTE = `#/${albumRoute(ARTIST, ALBUM)}`;

const openAlbum = async (page: Page) => {
	await openLibrary(page);
	await page.goto(`/${ROUTE}`);
	await expect(
		page.getByRole("heading", { level: 1, name: ALBUM }),
	).toBeVisible();
};

const albumRow = (page: Page) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(ALBUM, { exact: true }) })
		.getByRole("button")
		.first();

test.describe("an album is a place", () => {
	test("playing from it puts the record in the sidebar, under its own heading", async ({
		page,
		player,
	}) => {
		await openAlbum(page);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, ALBUM);
		expect(scratchOf(player)?.title).toBe(
			scratchTitle(SCRATCH_KIND.album, albumLabel(ARTIST, ALBUM)),
		);

		await page.goto("/#/home");
		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Album", { exact: true }),
		).toBeVisible();
		await albumRow(page).click();

		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe(ROUTE);
	});

	test("the now-playing header takes you back to the record", async ({
		page,
	}) => {
		await openAlbum(page);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, ALBUM);

		await page.goto("/#/home");
		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", { name: /Playing from/ })
			.click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe(ROUTE);
	});
});
