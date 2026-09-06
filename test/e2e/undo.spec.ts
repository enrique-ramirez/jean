import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	pressAndHold,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";

// Adding goes through the row menu rather than a drag: the menu is the route
// that exists on both surfaces. sidebar.spec.ts covers the drag.

const FAVORITES = { id: "p2", title: "Favorites", itemCount: 7 };
const LIBRARY = "p7";

const toast = (page: Page) => page.getByRole("status");
const titlesIn = (player: FakePlayer, id: string) =>
	player.playlists
		.find((entry) => entry.id === id)!
		.items.map((track) => track["%title%"]);

// Right-click on a pointer, press-and-hold on touch: the same menu, asked for
// the way each surface asks for it.
const openRowMenu = async (page: Page, index: number, isMobile: boolean) => {
	const target = trackRow(page, index);
	if (isMobile) await pressAndHold(page, target);
	else await target.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "Add to playlist" }),
	).toBeVisible();
};

const addToFavorites = async (page: Page, index: number, isMobile: boolean) => {
	await openRowMenu(page, index, isMobile);
	await page.getByRole("menuitem", { name: "Add to playlist" }).click();
	await page
		.getByRole("menuitem", { name: FAVORITES.title, exact: true })
		.click();
};

// An autoplaylist, which the API gives no way to recognise: PlaylistInfo says
// nothing about it and the write comes back 204 either way. The fake refuses it
// as the player does, by accepting it and doing nothing. See `useAddTracks`.
const AUTO = { id: "p9", title: "Recently Added", itemCount: 5 };

const addTo = async (
	page: Page,
	index: number,
	isMobile: boolean,
	title: string,
) => {
	await openRowMenu(page, index, isMobile);
	await page.getByRole("menuitem", { name: "Add to playlist" }).click();
	await page.getByRole("menuitem", { name: title, exact: true }).click();
};

test.describe("a playlist that takes the write and ignores it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("says so, rather than claiming the tracks landed", async ({
		page,
		player,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		// The request is sent and answers 204; there is no way to know beforehand.
		await expect
			.poll(() => requestsTo(player, "/items/").length)
			.toBeGreaterThan(0);

		await expect(toast(page)).toContainText(AUTO.title);
		await expect(toast(page)).toContainText("Nothing was added to");
		expect(titlesIn(player, AUTO.id)).toHaveLength(AUTO.itemCount);
	});

	test("offers no undo, because there is nothing to take off", async ({
		page,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		await expect(toast(page)).toContainText("Nothing was added to");
		await expect(toast(page).getByRole("button", { name: "Undo" })).toHaveCount(
			0,
		);
	});

	test("the playlist that does take them still says the true thing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, FAVORITES.title);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();
		await expect
			.poll(() => titlesIn(player, FAVORITES.id).length)
			.toBe(FAVORITES.itemCount + 1);
	});
});

test.describe("adding tracks to a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it says what happened, because you are not looking at it", async ({
		page,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();
	});

	test("a selection copies in one request, not one per track", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(3);

		await addToFavorites(page, 1, isMobile);

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/copy").length,
			1,
		);
		const copy = requestsTo(player, "/items/copy")[0];
		expect(copy.path).toBe(
			`/api/playlists/${LIBRARY}/${FAVORITES.id}/items/copy`,
		);
		expect(copy.body).toEqual({ items: [0, 1, 2] });

		await expect(toast(page)).toContainText(
			`Added 3 tracks to ${FAVORITES.title}`,
		);
	});
});

test.describe("undoing it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it takes off exactly what was put on", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, FAVORITES.id);

		await addToFavorites(page, 0, isMobile);
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 1);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		// The appended range, computed from the itemCount already in PlaylistInfo:
		// no %path% fetched, no matching, one request.
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			1,
		);
		expect(requestsTo(player, "/items/remove")[0].body).toEqual({
			items: [FAVORITES.itemCount],
		});

		// Titles rather than a count: removing the first track instead of the last
		// would leave the count right and the playlist wrong.
		await expect.poll(() => titlesIn(player, FAVORITES.id)).toEqual(before);
	});

	test("a multi-track add comes off in one piece", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		const before = titlesIn(player, FAVORITES.id);

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await addToFavorites(page, 1, isMobile);
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 3);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			1,
		);
		expect(requestsTo(player, "/items/remove")[0].body).toEqual({
			items: [7, 8, 9],
		});
		await expect.poll(() => titlesIn(player, FAVORITES.id)).toEqual(before);
	});

	// The indices are only ours while nothing else has touched the playlist, and
	// the desktop is a second writer Jean cannot see coming.
	test("it abandons itself when the playlist changed underneath", async ({
		page,
		player,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();

		// foobar2000 on the desktop, adding two tracks of its own while the toast
		// is still on screen. Now [7] is somebody else's track.
		await page.request.post("/__control/append", {
			data: { sourceId: LIBRARY, targetId: FAVORITES.id, items: [20, 21] },
		});
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 3);

		const after = titlesIn(player, FAVORITES.id);
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect(toast(page)).toContainText(
			`${FAVORITES.title} has changed since then`,
		);

		// It removed nothing, rather than removing the wrong rows and reporting it.
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			0,
		);
		expect(titlesIn(player, FAVORITES.id)).toEqual(after);
	});

	test("the toast can be dismissed without undoing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);
		await expect(toast(page)).toBeVisible();

		await toast(page).getByRole("button", { name: "Dismiss" }).click();
		await expect(toast(page)).toHaveCount(0);

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			0,
		);
		expect(
			player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
		).toHaveLength(FAVORITES.itemCount + 1);
	});
});

test.describe("what does not get a toast", () => {
	test("creating a playlist says nothing, because the row is right there", async ({
		page,
	}) => {
		await openLibrary(page);

		const sidebar = page.getByRole("navigation", { name: "Playlists" });
		if (!(await sidebar.isVisible())) {
			await page.getByRole("button", { name: "Show playlists" }).click();
		}

		await page.getByRole("button", { name: "New playlist" }).click();
		await expect(
			page.getByRole("textbox", { name: "Rename New playlist" }),
		).toBeFocused();

		await expect(toast(page)).toHaveCount(0);
	});
});
