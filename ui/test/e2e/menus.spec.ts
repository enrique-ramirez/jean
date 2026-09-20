import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	openSidebar,
	pressAndHold,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

// `ui/ActionMenu.tsx` is one component with two shapes: a popover at the pointer
// on a desktop viewport, an action sheet on a compact one. Both projects run
// this file, so every assertion below is made against both.
//
// Driven through the track menu, which has a nested page, a typed filter, and a
// list long enough to filter.

const menuItem = (page: Page, name: string | RegExp) =>
	page.getByRole("menuitem", { name });

const openTrackMenu = async (page: Page, isMobile: boolean) => {
	const row = trackRow(page, 0);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(menuItem(page, "Add to playlist")).toBeVisible();
};

const openTargets = async (page: Page, isMobile: boolean) => {
	await openTrackMenu(page, isMobile);
	await menuItem(page, "Add to playlist").click();
	await expect(menuItem(page, "Favorites")).toBeVisible();
};

const filterField = (page: Page) =>
	page.getByRole("textbox", { name: "Find a playlist" });

test.describe("the menu names what it is about", () => {
	test("a single row is headed by the track", async ({ page, isMobile }) => {
		await openLibrary(page);
		await openTrackMenu(page, isMobile);

		// On a phone the sheet covers the row it was summoned from, so the header is
		// the only thing naming the track. Scoped to the menu, because the row it
		// names is on screen behind it.
		const menu = page
			.locator("body > div")
			.filter({ has: menuItem(page, "Add to playlist") });
		await expect(menu).toContainText("Los Calientes");
		await expect(menu).toContainText("Babasónicos");
	});

	test("a selection is headed by its size instead", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		await openLibrary(page);
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(3);

		await openTrackMenu(page, isMobile);
		await expect(page.getByText("3 tracks")).toBeVisible();
	});
});

test.describe("a nested page", () => {
	test("it slides in place and steps back where it came from", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTrackMenu(page, isMobile);

		// The back button is named after the page it came from, which stays in the
		// panel, inert and slid aside.
		const back = page.getByRole("button", { name: "Add to playlist" });
		await expect(back).toHaveCount(0);

		await menuItem(page, "Add to playlist").click();
		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(back).toBeVisible();

		await back.click();
		await expect(back).toHaveCount(0);
		await expect(menuItem(page, "Add to playlist")).toBeVisible();
	});

	test("it offers the playlists you can file into, and no others", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTargets(page, isMobile);

		// Not the open playlist, and not Jean's scratch, which the next search
		// empties.
		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(menuItem(page, "Rock en Español")).toBeVisible();
		await expect(menuItem(page, /^Library$/)).toHaveCount(0);
		await expect(menuItem(page, /#Jean/)).toHaveCount(0);
	});
});

test.describe("typing at a menu", () => {
	test("it narrows the page, through the same matching as everything else", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTargets(page, isMobile);

		await filterField(page).fill("espanol");

		await expect(menuItem(page, "Rock en Español")).toBeVisible();
		await expect(menuItem(page, "Favorites")).toHaveCount(0);
	});

	test("it says so when nothing matches, rather than emptying the page", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTargets(page, isMobile);

		await filterField(page).fill("zzzz");
		await expect(page.getByText("Nothing matches that.")).toBeVisible();
	});

	test("Enter takes the first match, without reaching for the arrows", async ({
		page,
		isMobile,
		player,
	}) => {
		test.skip(isMobile, "there is no Enter key on the phone");

		await openLibrary(page);
		await openTargets(page, isMobile);

		await filterField(page).fill("fav");
		await filterField(page).press("Enter");

		await expect(page.getByRole("status")).toContainText("Favorites");
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.title === "Favorites")!.items
						.length,
			)
			.toBe(8);
	});

	test("the field takes focus on a pointer and waits to be tapped on touch", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTargets(page, isMobile);

		// On a phone, focusing on open costs half the screen to a keyboard nobody
		// asked for; where there is already a keyboard, not focusing wastes a
		// keystroke.
		if (isMobile) await expect(filterField(page)).not.toBeFocused();
		else await expect(filterField(page)).toBeFocused();
	});
});

test.describe("while a menu is open", () => {
	test("no key belongs to the app behind it", async ({
		page,
		isMobile,
		player,
	}) => {
		test.skip(isMobile, "these are keyboard events");

		await openLibrary(page);
		await openTrackMenu(page, isMobile);

		// Without stopping propagation these seek the player and toggle playback.
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Space");

		await expectSettlesAt(
			player,
			() =>
				player.requests.filter((entry) => entry.path.startsWith("/api/player")),
			[],
		);
	});

	test("Escape closes it and does nothing else", async ({ page, isMobile }) => {
		test.skip(isMobile, "these are keyboard events");

		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await expect(trackRow(page, 1)).toHaveAttribute("data-cursor", "true");

		await openTrackMenu(page, isMobile);
		await page.keyboard.press("Escape");

		await expect(menuItem(page, "Add to playlist")).toHaveCount(0);
		// The same key clears the track selection when no menu is open, so this is
		// also the check that it did not reach past the menu.
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(1);
	});
});

// The other menu surface, and the reason `menuKeys.ts` exists: a dropdown opened
// from a visible button rather than summoned at the pointer.
test.describe("a dropdown owns the keyboard too", () => {
	test.skip(({ isMobile }) => isMobile, "these are keyboard events");

	const viewOptions = (page: Page) =>
		page.getByRole("button", { name: "View options" });
	const columnOption = (page: Page, name: string) =>
		page.getByRole("menuitemcheckbox", { name });

	test("Escape closes it without reaching the list behind it", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await expect(trackRow(page, 1)).toHaveAttribute("data-cursor", "true");

		await viewOptions(page).click();
		await expect(columnOption(page, "Artwork")).toBeVisible();

		await page.keyboard.press("Escape");

		await expect(columnOption(page, "Artwork")).toHaveCount(0);
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(1);
	});

	test("the arrows walk its options rather than seeking the player", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await viewOptions(page).click();
		await expect(columnOption(page, "Artwork")).toBeVisible();

		// Which option is first depends on what the player can supply, so this asks
		// only that the arrows land on options and then move between them.
		const focused = () =>
			page.evaluate(() => [
				document.activeElement!.getAttribute("role"),
				document.activeElement!.textContent!.trim(),
			]);

		await page.keyboard.press("ArrowDown");
		const [firstRole, first] = await focused();
		expect(firstRole).toMatch(/^menuitem/);

		await page.keyboard.press("ArrowDown");
		const [secondRole, second] = await focused();
		expect(secondRole).toMatch(/^menuitem/);
		expect(second).not.toBe(first);

		// And the horizontal pair, which is what seeks the player everywhere else.
		await page.keyboard.press("ArrowRight");
		await expectSettlesAt(
			player,
			() =>
				player.requests.filter((entry) => entry.path.startsWith("/api/player")),
			[],
		);
	});
});

test.describe("an install that will not let Jean change playlists", () => {
	test.use({ fooJean: { canWritePlaylists: false } });

	const playlistRow = (page: Page, title: string) =>
		sidebar(page).locator("> div").filter({ hasText: title });

	const movesAsked = (player: FakePlayer) =>
		player.requests
			.filter(
				(entry) => entry.method === "POST" && entry.path.endsWith("/move"),
			)
			.map((entry) => entry.path);

	test("the sidebar offers no edits rather than buttons that would 403", async ({
		page,
	}) => {
		await openLibrary(page);
		await openSidebar(page);

		await expect(
			page.getByRole("button", { name: "New playlist" }),
		).toHaveCount(0);
		await expect(
			sidebar(page).getByRole("button", { name: /Favorites/ }),
		).toBeVisible();
	});

	// The menu is where a row is filed from on both surfaces, so its absence is
	// what a phone notices. Everything else in the menu stays: the setting refuses
	// playlist writes and nothing else.
	test("the row menu offers nowhere to file a track", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);

		const row = trackRow(page, 0);
		if (isMobile) await pressAndHold(page, row);
		else await row.click({ button: "right" });
		await expect(menuItem(page, "Add to queue")).toBeVisible();

		await expect(menuItem(page, /Add to playlist/)).toHaveCount(0);
	});

	test("a playlist row offers no rename and no delete", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openSidebar(page);

		const favorites = playlistRow(page, "Favorites");
		if (isMobile) await pressAndHold(page, favorites);
		else await favorites.click({ button: "right" });

		await expect(menuItem(page, "Rename")).toHaveCount(0);
		await expect(menuItem(page, "Delete")).toHaveCount(0);
	});

	test("a playlist cannot be dragged or keyed into another position", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "reordering is a grip and a key, both desktop-only");

		await openLibrary(page);
		await openSidebar(page);

		const first = playlistRow(page, "Default Playlist");
		const second = playlistRow(page, "Library");
		const from = (await first.boundingBox())!;
		const onto = (await second.boundingBox())!;

		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(
			onto.x + onto.width / 2,
			onto.y + onto.height * 0.75,
			{ steps: 12 },
		);
		await page.mouse.up();

		// Focused first, or the keys would be refused by a caret that never landed
		// rather than by the setting.
		const row = sidebar(page)
			.getByRole("button", { name: /Default Playlist/ })
			.first();
		await row.focus();
		await expect(row).toBeFocused();
		await page.keyboard.press("Alt+ArrowDown");

		await expectSettlesAt(player, () => movesAsked(player), []);
		expect(player.playlists.map((entry) => entry.title).slice(0, 2)).toEqual([
			"Default Playlist",
			"Library",
		]);
	});
});

test.describe("a player whose own permissions refuse playlist changes", () => {
	test.use({
		playerState: {
			permissions: {
				changePlaylists: false,
				changeOutput: true,
				changeClientConfig: true,
			},
		},
	});

	// beefweb's own permission is not what gates an edit. Filing a row goes to
	// foo_jean over its own port, so the item carries no reason: the only setting
	// that can refuse it is the player owner's, held by the component, and this
	// install has not set it.
	test("the row menu still offers somewhere to file a track", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTrackMenu(page, isMobile);

		const add = menuItem(page, /Add to playlist/);
		// Named rather than left to the click's own actionability wait, which reports
		// a timeout where the real answer is that the item was refused.
		await expect(add).toBeEnabled();
		await expect(add).not.toHaveAccessibleName(/foo_jean/i);

		await add.click();
		await expect(menuItem(page, "Favorites")).toBeVisible();
	});
});
