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

// Jean's own two playlists are plumbing rather than music: the scratch a library
// view is played from, and the holding playlist a queued library row lands in.
// Both sit on the player under titles a user can read, in the same list beefweb
// answers with, so every surface that shows playlists has to take them back out.

const menuItem = (page: Page, name: string | RegExp) =>
	page.getByRole("menuitem", { name });

const openTrackMenu = async (page: Page, isMobile: boolean, index: number) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(menuItem(page, "Add to playlist")).toBeVisible();
};

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const jeanTitles = (player: FakePlayer) =>
	player.playlists
		.map((entry) => entry.title)
		.filter((title) => title.startsWith("#Jean"))
		.sort();

const playlistNamed = (player: FakePlayer, title: string) =>
	player.playlists.find((entry) => entry.title === title)!;

// Neither playlist exists until it is needed: queueing a library row makes the
// holding playlist, playing the view makes the scratch. The "Playing from" line
// is the scratch's own title, parsed out of the list the browser polled, so it
// is also the proof that the browser is filtering a list it holds rather than an
// empty one.
const withBothJeanPlaylists = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
) => {
	await openAllMusic(page);

	await openTrackMenu(page, isMobile, 1);
	await menuItem(page, "Add to queue").click();
	await expect.poll(() => player.playQueue.length, { timeout: 10_000 }).toBe(1);

	// Queueing opens the panel, and on a phone it is over the list.
	await queuePanel(page)
		.getByRole("button", { name: "Close the queue" })
		.click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "false");

	await trackRow(page, 0).dblclick();
	await expect
		.poll(() => scratchOf(player)?.title, { timeout: 10_000 })
		.toBe("#Jean [all music]");
	await expectPlayingFrom(page, "All music");

	expect(jeanTitles(player)).toEqual([
		"#Jean Library",
		"#Jean Queue",
		"#Jean [all music]",
	]);
};

test.describe("the #Jean namespace", () => {
	test("stays out of the sidebar", async ({ page, player, isMobile }) => {
		await withBothJeanPlaylists(page, player, isMobile);

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
		await withBothJeanPlaylists(page, player, isMobile);

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
		isMobile,
	}) => {
		await withBothJeanPlaylists(page, player, isMobile);
		const heading = viewHeader(page).getByRole("heading", { level: 1 });

		await page.goto("/#/p2");
		await expect(heading).toHaveText("Favorites");

		await inSequence(
			[playlistNamed(player, "#Jean Queue"), scratchOf(player)!],
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
		await withBothJeanPlaylists(page, player, isMobile);

		await openTrackMenu(page, isMobile, 2);
		await menuItem(page, "Add to playlist").click();

		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(menuItem(page, /#Jean/)).toHaveCount(0);
	});
});
