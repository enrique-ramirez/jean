import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	inSequence,
	openAllMusic,
	openSidebar,
	pressAndHold,
	scratchOf,
	sidebar,
	test,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

const menuItem = (page: Page, name: string | RegExp) =>
	page.getByRole("menuitem", { name });

const openTrackMenu = async (page: Page, isMobile: boolean, index: number) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(menuItem(page, "Add to playlist")).toBeVisible();
};

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
		.toBe("#Jean [all music]");
	await expectPlayingFrom(page, "All music");

	expect(jeanTitles(player)).toEqual(["#Jean Library", "#Jean [all music]"]);
};

test.describe("the #Jean namespace", () => {
	test("stays out of the sidebar", async ({ page, player }) => {
		await withBothJeanPlaylists(page, player);

		await openSidebar(page);
		await expect(
			sidebar(page).getByRole("button").filter({ hasText: "Favorites" }),
		).toHaveCount(1);
		await expect(sidebar(page).getByText(/#Jean/)).toHaveCount(0);
	});

	test("stays out of the command palette", async ({
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
		await expect(palette.getByRole("option", { name: /#Jean/ })).toHaveCount(0);
	});

	test("is not where a route naming one of them lands", async ({
		page,
		player,
	}) => {
		await withBothJeanPlaylists(page, player);
		const heading = viewHeader(page).getByRole("heading", { level: 1 });

		await page.goto("/#/p2");
		await expect(heading).toHaveText("Favorites");

		await inSequence(
			[playlistNamed(player, "#Jean Library"), scratchOf(player)!],
			async (playlist) => {
				await page.goto(`/#/${playlist.id}`);
				await expect(heading).toBeVisible();
				await expect(heading).not.toHaveText(/#Jean/);
			},
		);
	});

	test("stays out of the playlists a track can be added to", async ({
		page,
		player,
		isMobile,
	}) => {
		await withBothJeanPlaylists(page, player);

		await openTrackMenu(page, isMobile, 2);
		await menuItem(page, "Add to playlist").click();

		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(menuItem(page, /#Jean/)).toHaveCount(0);
	});
});
