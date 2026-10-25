import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	openAllMusic,
	test,
	titleOfPlaylist,
	titlesIn,
	toastRegion,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import { openRowMenu } from "./menus.ts";
import {
	everyPage,
	expectRowLanded,
	expectRowPending,
	fromTheSecondWindow,
	holdPlaylistPages,
	LONG_PLAYLIST,
	LONG_PLAYLIST_ROWS,
	pageAsks,
	scrollToRow,
	WINDOW_ROWS,
} from "./playlistPages.ts";
import { scrollTop } from "./scrolling.ts";

const SPANISH = "p5";
const AUTOPLAYLIST = "p9";

const REMOVE = "Remove from playlist";

const structureOf = (player: FakePlayer, key: string) =>
	String(player.playlists.find((entry) => entry.id === key)!.structure);

const openPlaylist = async (page: Page, player: FakePlayer, key: string) => {
	await page.goto(`/#/${guidOfPlaylist(player, key)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: titleOfPlaylist(player, key) }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
	return titlesIn(player, key).map(String);
};

const removeItem = (page: Page) => page.getByRole("menuitem", { name: REMOVE });

const removals = (player: FakePlayer, key: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			entry.path ===
				`/api/playlists/${guidOfPlaylist(player, key)}/items/remove`,
	);

const rowReads = (player: FakePlayer, key: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] ===
				`/api/playlists/${guidOfPlaylist(player, key)}/items`,
	);

const selected = (page: Page) =>
	page.locator('[role="row"][data-selected="true"]');

test.describe("removing a row from a playlist", () => {
	test("the row menu takes it out of the playlist at the player", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = await openPlaylist(page, player, SPANISH);
		const structure = structureOf(player, SPANISH);

		await openRowMenu(page, isMobile, 1, "Add to queue");
		await removeItem(page).click();

		const after = before.filter((_, at) => at !== 1);
		await expectSettlesAt(player, () => titlesIn(player, SPANISH), after);
		expect(removals(player, SPANISH).map((entry) => entry.body)).toEqual([
			{ structure, ordinals: [1] },
		]);

		await expect(toastRegion(page)).toContainText(
			`Removed 1 track from ${titleOfPlaylist(player, SPANISH)}`,
		);
		await expect(trackRow(page, 1)).toContainText(before[2]);
		await expect(trackRow(page, before.length - 1)).toHaveCount(0);
	});

	// The removal answers the structure the playlist now stands at, so the rows held are re-keyed
	// to it. Reading the playlist again would be a request per removal while somebody prunes one.
	test("the rows that remain are not read again", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = await openPlaylist(page, player, SPANISH);
		const reads = rowReads(player, SPANISH).length;

		await openRowMenu(page, isMobile, 0, "Add to queue");
		await removeItem(page).click();

		await expectSettlesAt(
			player,
			() => titlesIn(player, SPANISH),
			before.slice(1),
		);
		await expect(trackRow(page, 0)).toContainText(before[1]);
		expect(rowReads(player, SPANISH)).toHaveLength(reads);
	});

	test("Delete removes the whole selection and leaves the cursor on the row that closed the gap", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "there is no Delete key on the phone");

		const before = await openPlaylist(page, player, SPANISH);

		await trackRow(page, 1).click();
		await trackRow(page, 2).click({ modifiers: ["Shift"] });
		await expect(selected(page)).toHaveCount(2);
		await page.keyboard.press("Delete");

		const after = before.filter((_, at) => at !== 1 && at !== 2);
		await expectSettlesAt(player, () => titlesIn(player, SPANISH), after);
		await expect(toastRegion(page)).toContainText(
			`Removed 2 tracks from ${titleOfPlaylist(player, SPANISH)}`,
		);
		await expect(selected(page)).toHaveCount(1);
		await expect(selected(page)).toContainText(before[3]);
	});

	test("a removal the player refuses puts the row back and says so", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = await openPlaylist(page, player, SPANISH);
		const locked = await page.request.post("/__control/lockPlaylist", {
			data: { id: SPANISH, locked: true },
		});
		expect(locked.ok(), "the fake needs /__control/lockPlaylist").toBe(true);

		await openRowMenu(page, isMobile, 1, "Add to queue");
		await removeItem(page).click();

		await expect(toastRegion(page)).toContainText(
			`foobar2000 refused the edit to ${titleOfPlaylist(player, SPANISH)}`,
		);
		await expect(trackRow(page, 1)).toContainText(before[1]);
		expect(titlesIn(player, SPANISH)).toEqual(before);
	});
});

test.describe("where a row cannot be removed", () => {
	test("an autoplaylist's rows offer no removal", async ({
		page,
		player,
		isMobile,
	}) => {
		await openPlaylist(page, player, AUTOPLAYLIST);
		await openRowMenu(page, isMobile, 0, "Add to queue");

		await expect(removeItem(page)).toHaveCount(0);
	});

	test("a library view's rows are in no playlist to be removed from", async ({
		page,
		isMobile,
	}) => {
		await openAllMusic(page);
		await openRowMenu(page, isMobile, 0, "Add to queue");

		await expect(removeItem(page)).toHaveCount(0);
	});

	test("an install that refuses playlist writes offers none", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.request.post("/__control/writePlaylists", {
			data: { canWrite: false },
		});
		await openPlaylist(page, player, SPANISH);
		await openRowMenu(page, isMobile, 0, "Add to queue");

		await expect(removeItem(page)).toHaveCount(0);
	});
});

test.describe("removing a row with a pending window on screen", () => {
	test.use({ librarySize: LONG_PLAYLIST_ROWS });

	const REMOVED = WINDOW_ROWS - 8;
	const LAST_HELD = WINDOW_ROWS - 1;

	test("closes the gap over the rows held, leaves the row it pulls up from a pending position pending, and holds the list still", async ({
		page,
		player,
		isMobile,
	}) => {
		const pages = await holdPlaylistPages(
			page,
			player,
			LONG_PLAYLIST,
			fromTheSecondWindow,
		);
		const before = await openPlaylist(page, player, LONG_PLAYLIST);
		const structure = structureOf(player, LONG_PLAYLIST);
		await scrollToRow(page, REMOVED - 10);
		await expectRowLanded(page, REMOVED, before[REMOVED]);
		await expectRowPending(page, WINDOW_ROWS);
		const top = await scrollTop(page);
		const from = player.requests.length;
		pages.holdAlso(everyPage);

		await openRowMenu(page, isMobile, REMOVED, "Add to queue");
		await removeItem(page).click();

		const after = before.filter((_, at) => at !== REMOVED);
		await expectSettlesAt(player, () => titlesIn(player, LONG_PLAYLIST), after);
		expect(removals(player, LONG_PLAYLIST).map((entry) => entry.body)).toEqual([
			{ structure, ordinals: [REMOVED] },
		]);
		await expect(toastRegion(page)).toContainText(
			`Removed 1 track from ${titleOfPlaylist(player, LONG_PLAYLIST)}`,
		);
		await expectRowLanded(page, REMOVED, before[REMOVED + 1]);
		await expectRowLanded(page, LAST_HELD - 1, before[LAST_HELD]);
		await expectRowPending(page, LAST_HELD);
		expect(Math.abs((await scrollTop(page)) - top)).toBeLessThanOrEqual(1);

		await pages.release();
		await expectRowLanded(page, LAST_HELD, before[WINDOW_ROWS]);
		await untilQuiet(player);
		expect(Math.abs((await scrollTop(page)) - top)).toBeLessThanOrEqual(1);
		for (const ask of pageAsks(player, LONG_PLAYLIST, from))
			expect([0, WINDOW_ROWS], JSON.stringify(ask)).toContain(ask.offset);
	});
});
