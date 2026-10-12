import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	openAllMusic,
	openSidebar,
	scratchOf,
	sidebar,
	test,
	trackRow,
	viewHeader,
} from "./fixtures.ts";
import { openRowMenu } from "./menus.ts";

// The playlist the component keeps for playing a set, which it titles in its own
// namespace so somebody reading foobar2000's playlist list can tell whose it is.
const SCRATCH = "#Jean [all music]";

// A playlist the fixture's user made and happened to title with that same
// prefix. The component gives it no role, so it is their music and Jean draws it
// like any other. A title the two can share decides nothing.
const USERS = "#Jean Library";

const menuItem = (page: Page, name: string) =>
	page.getByRole("menuitem", { name });

// Counted rather than matched, so a row that is drawn fails on the count
// instead of on a strict-mode violation somewhere else.
const sidebarRow = (page: Page, title: string) =>
	sidebar(page).getByRole("button").filter({ hasText: title });

const jeanTitles = (player: FakePlayer) =>
	player.playlists
		.map((entry) => entry.title)
		.filter((title) => title.startsWith("#Jean"))
		.sort();

const playlistNamed = (player: FakePlayer, title: string) =>
	player.playlists.find((entry) => entry.title === title)!;

const withBothJeanPlaylists = async (page: Page, player: FakePlayer) => {
	await openAllMusic(page);

	await trackRow(page, 0).dblclick();
	await expect
		.poll(() => scratchOf(player)?.title, { timeout: 10_000 })
		.toBe(SCRATCH);
	await expectPlayingFrom(page, "All music");

	expect(jeanTitles(player)).toEqual([USERS, SCRATCH]);
};

test.describe("the scratch playlist, and the namespace it is titled in", () => {
	test("the sidebar draws the user's own and not the scratch", async ({
		page,
		player,
	}) => {
		await withBothJeanPlaylists(page, player);

		await openSidebar(page);
		await expect(sidebarRow(page, "Favorites")).toHaveCount(1);
		await expect(sidebarRow(page, USERS)).toHaveCount(1);
		await expect(sidebarRow(page, SCRATCH)).toHaveCount(0);
	});

	test("the command palette offers the user's own and not the scratch", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the palette is opened and driven entirely by keys");
		await withBothJeanPlaylists(page, player);

		await page.keyboard.press("g");
		const palette = page.getByRole("dialog", { name: "Go to" });
		await expect(
			palette.getByRole("option", { name: "Favorites" }),
		).toBeVisible();
		await expect(palette.getByRole("option", { name: USERS })).toHaveCount(1);
		await expect(palette.getByRole("option", { name: SCRATCH })).toHaveCount(0);
	});

	test("a route naming the user's own opens it, and one naming the scratch lands elsewhere", async ({
		page,
		player,
	}) => {
		await withBothJeanPlaylists(page, player);
		const heading = viewHeader(page).getByRole("heading", { level: 1 });

		await page.goto(`/#/${playlistNamed(player, "Favorites").guid}`);
		await expect(heading).toHaveText("Favorites");

		await page.goto(`/#/${playlistNamed(player, USERS).guid}`);
		await expect(heading).toHaveText(USERS);

		// Landing on the scratch would show whatever set was last played, stripped
		// of the view that made it.
		await page.goto(`/#/${scratchOf(player)!.guid}`);
		await expect(heading).toBeVisible();
		await expect(heading).not.toHaveText(SCRATCH);
	});

	test("Add to playlist offers the user's own and not the scratch", async ({
		page,
		player,
		isMobile,
	}) => {
		await withBothJeanPlaylists(page, player);

		await openRowMenu(page, isMobile, 2, "Add to playlist");
		await menuItem(page, "Add to playlist").click();

		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(menuItem(page, USERS)).toHaveCount(1);
		await expect(menuItem(page, SCRATCH)).toHaveCount(0);
	});
});
