import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	dragAcrossTheSheet,
	dragFromTheScrim,
	expect,
	expectSettlesAt,
	focusedEndOf,
	fromTheGrabber,
	openLibrary,
	openSidebar,
	playRequests,
	pressAndHold,
	restingBox,
	scrollTop,
	scrollUntilMounted,
	scrollUntilMounted,
	sidebar,
	statusBar,
	test,
	touchDrag,
	trackRow,
	untilQuiet,
	watchHowFarItMoves,
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

const isTransportCommand = (path: string) =>
	path.startsWith("/api/playback/") || path === "/api/volume";

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const isFocusInTheMenu = (page: Page) =>
	page
		.getByRole("menu")
		.first()
		.evaluate((menu) => {
			let panel: Element = menu;
			while (panel.parentElement && panel.parentElement !== document.body)
				panel = panel.parentElement;
			return panel.contains(document.activeElement);
		});

// Stop rather than Space or an arrow: focus is on whichever control comes before the menu, and
// a browser or the control answers those itself.
const STOP_KEY = "ControlOrMeta+.";

const MENUS_OVER_THE_QUEUE = [
	{
		name: "a row's menu",
		open: (page: Page) => trackRow(page, 0).click({ button: "right" }),
	},
	{
		name: "the Sort menu",
		open: (page: Page) => page.getByRole("button", { name: "Sort" }).click(),
	},
];

// In the captured library, with enough tracks to fill its Tracks tab.
const ARTIST = "Babasónicos";

test.describe("the menu names what it is about", () => {
	test("a single row is headed by the track", { tag: "@iphone" }, async ({
		page,
		isMobile,
	}) => {
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

	test("Escape at its field steps back a page, and Escape again closes the menu", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the field waits to be tapped on touch");

		await openLibrary(page);
		await openTargets(page, isMobile);
		await expect(filterField(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(menuItem(page, "Favorites")).toHaveCount(0);
		await expect(menuItem(page, "Add to playlist")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByRole("menu")).toHaveCount(0);
	});

	test("it offers the playlists you can file into, and no others", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTargets(page, isMobile);

		// Every playlist but the open one, which is where these tracks already are.
		// `#Jean Library` is the user's, titled in the prefix the component uses
		// for its own, and a title decides nothing: only the role does, and
		// `jean-namespace.spec.ts` is where this menu meets a playlist carrying one.
		await expect(menuItem(page, "Favorites")).toBeVisible();
		await expect(menuItem(page, "Rock en Español")).toBeVisible();
		await expect(menuItem(page, "#Jean Library")).toHaveCount(1);
		await expect(menuItem(page, /^Library$/)).toHaveCount(0);
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

		await filterField(page).fill("def");
		await filterField(page).press("Enter");

		await expect(page.getByRole("status")).toContainText("Default Playlist");
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.title === "Default Playlist")!
						.items.length,
			)
			.toBe(5);
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
			() => player.requests.filter((entry) => isTransportCommand(entry.path)),
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

	// The queue panel closes on Escape too, and a menu opened with it up is in front of it.
	for (const { name, open } of MENUS_OVER_THE_QUEUE) {
		test(`with the queue panel open behind ${name}, Escape closes the menu and not the panel, and Escape again closes the panel`, async ({
			page,
			isMobile,
		}) => {
			test.skip(isMobile, "these are keyboard events");

			await openLibrary(page);
			await statusBar(page)
				.getByRole("button", { name: /^Queue/ })
				.click();
			await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
			await open(page);
			await expect(page.getByRole("menu")).toBeVisible();

			await page.keyboard.press("Escape");
			await expect(page.getByRole("menu")).toHaveCount(0);
			await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

			await page.keyboard.press("Escape");
			await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
		});
	}

	// The menu stops the keys typed inside it, and Shift+Tab is one press out of it.
	test("once focus has left it, no key reaches the player and Escape still closes it", async ({
		page,
		isMobile,
		player,
	}) => {
		test.skip(isMobile, "a sheet is modal, and keeps Tab inside it");

		await openLibrary(page);
		await openTrackMenu(page, isMobile);
		await page.keyboard.press("Shift+Tab");
		await expect
			.poll(() => isFocusInTheMenu(page), { message: "focus, in the menu" })
			.toBe(false);

		await page.keyboard.press(STOP_KEY);
		await expectSettlesAt(
			player,
			() => player.requests.filter((entry) => isTransportCommand(entry.path)),
			[],
		);

		await page.keyboard.press("Escape");
		await expect(page.getByRole("menu")).toHaveCount(0);
	});
});

// On a phone the keys are an attached keyboard's.
test.describe("the action sheet, from a keyboard", () => {
	test.skip(({ isMobile }) => !isMobile, "a sheet is the compact shape");

	test("Tab from the last control wraps to the first, and Shift+Tab from the first to the last", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openTrackMenu(page, isMobile);
		const sheet = page.getByRole("dialog");

		await page.keyboard.press("Tab");
		await expect.poll(() => focusedEndOf(sheet)).toBe("first");
		await page.keyboard.press("Shift+Tab");
		await expect.poll(() => focusedEndOf(sheet)).toBe("last");
		await page.keyboard.press("Tab");
		await expect.poll(() => focusedEndOf(sheet)).toBe("first");
	});
});

// An artist's page reads a sideways flick as a step between its tabs.
test.describe("an action sheet keeps a touch that begins on it", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"a sheet is the compact shape, and this is touch",
	);

	test("a sideways drag across a row's sheet on an artist's Tracks tab leaves the tab and the sheet as they were", async ({
		page,
		player,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");

		await page.goto(`/#/artist/${encodeURIComponent(ARTIST)}/tracks`);
		await expect(trackRow(page, 0)).toBeAttached();
		await pressAndHold(page, trackRow(page, 0));
		const sheet = page.getByRole("dialog");
		await expect(sheet).toBeVisible();

		await dragAcrossTheSheet(page, sheet, "right");

		await untilQuiet(player);
		await expect(page).toHaveURL(/\/tracks$/);
		await expect(sheet).toBeVisible();
	});

	test("a sideways drag that begins on the scrim of a row's sheet on an artist's Tracks tab closes the sheet and leaves the tab where it was", async ({
		page,
		player,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");

		await page.goto(`/#/artist/${encodeURIComponent(ARTIST)}/tracks`);
		await expect(trackRow(page, 0)).toBeAttached();
		await pressAndHold(page, trackRow(page, 0));
		const sheet = page.getByRole("dialog");
		await expect(sheet).toBeVisible();

		await dragFromTheScrim(page, sheet, "right");

		await expect(sheet).toHaveCount(0);
		await untilQuiet(player);
		await expect(page).toHaveURL(/\/tracks$/);
	});
});

// The track at the top of the library, whose title a row's sheet is named by.
const FIRST_TITLE = "Los Calientes";

// Either side of the distance a sheet's grabber has to travel before letting go closes the
// sheet, each far enough from it that the gesture is unambiguous.
const SHORT_OF_CLOSING_PX = 50;
const PAST_CLOSING_PX = 140;

// Enough moves that the browser paints the sheet between them.
const DRAG_STEPS = 12;

// A box is fractional, so a sheet back at rest can sit a fraction of a pixel off.
const AT_REST_PX = 1;

// Longer than a sheet on its way out stays drawn, so one still there after it was never closed.
const PAST_ITS_EXIT_MS = 600;

// Enough playlists that the filing page is taller than the sheet's limit and scrolls.
const MORE_PLAYLISTS = 24;

const openRowSheet = async (page: Page) => {
	await openLibrary(page);
	await pressAndHold(page, trackRow(page, 0));
	const sheet = page.getByRole("dialog", { name: FIRST_TITLE });
	await expect(sheet).toBeVisible();
	return sheet;
};

// A sheet on its way out stays drawn until its exit has run, so being visible says nothing about
// whether it is open. One that answers a press is.
const expectRowSheetOpen = async (page: Page) => {
	await menuItem(page, "Add to playlist").click();
	await expect(menuItem(page, "Favorites")).toBeVisible();
};

test.describe("a row's action sheet goes by a drag down", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"a sheet is the compact shape, and this is touch",
	);
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"a finger is driven through CDP",
	);

	test("the grabber dragged down past the distance closes the sheet", async ({
		page,
	}) => {
		const sheet = await openRowSheet(page);

		await fromTheGrabber(page, sheet, PAST_CLOSING_PX);

		await expect(sheet).toHaveCount(0);
	});

	test("the grabber dragged a shorter way carries the sheet with it, and letting go leaves it open where it rested", async ({
		page,
	}) => {
		const sheet = await openRowSheet(page);
		const before = await restingBox(sheet);
		const furthest = await watchHowFarItMoves(sheet);

		await fromTheGrabber(page, sheet, SHORT_OF_CLOSING_PX);

		// Settled first, or the box read below is one the sheet passed on its way back.
		const after = await restingBox(sheet);
		expect(
			await furthest(),
			"how far the sheet followed the finger",
		).toBeGreaterThan(AT_REST_PX);
		expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(AT_REST_PX);
		await expectRowSheetOpen(page);
	});

	test("a downward drag that begins on the sheet's body, past the distance, closes the sheet", async ({
		page,
	}) => {
		const sheet = await openRowSheet(page);
		const box = await restingBox(sheet);

		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await touchDrag(page, { x, y }, { x, y: y + PAST_CLOSING_PX }, DRAG_STEPS);

		await expect(sheet).toHaveCount(0);
	});

	test("a downward drag on a list scrolled away from its top scrolls it back and moves the sheet nowhere", async ({
		page,
		player,
	}) => {
		for (let index = 0; index < MORE_PLAYLISTS; index++)
			player.addPlaylist(`Crate ${index + 1}`);

		const sheet = await openRowSheet(page);
		await menuItem(page, "Add to playlist").click();
		const first = menuItem(page, "Favorites");
		await expect(first).toBeVisible();
		const box = await restingBox(sheet);
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			DRAG_STEPS,
		);
		const scrolled = await restingBox(first);
		expect(scrolled.y, "the first playlist, scrolled up").toBeLessThan(box.y);
		const furthest = await watchHowFarItMoves(sheet);

		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.3 },
			{ x, y: box.y + box.height * 0.3 + PAST_CLOSING_PX },
			DRAG_STEPS,
		);

		const after = await restingBox(first);
		expect(after.y, "the first playlist, scrolled back").toBeGreaterThan(
			scrolled.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await page.waitForTimeout(PAST_ITS_EXIT_MS);
		await expect(sheet).toHaveCount(1);
		await expect(first).toBeVisible();
	});

	// A sheet that drags from anywhere has to stop a touch on its list from panning, and then
	// a list longer than the sheet's limit has no way to show its end.
	test("a drag up the list of a row's sheet scrolls the list and moves the sheet nowhere", async ({
		page,
		player,
	}) => {
		for (let index = 0; index < MORE_PLAYLISTS; index++)
			player.addPlaylist(`Crate ${index + 1}`);

		const sheet = await openRowSheet(page);
		await menuItem(page, "Add to playlist").click();
		const first = menuItem(page, "Favorites");
		await expect(first).toBeVisible();
		const box = await restingBox(sheet);
		const firstBefore = await restingBox(first);
		const furthest = await watchHowFarItMoves(sheet);

		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			DRAG_STEPS,
		);

		const firstAfter = await restingBox(first);
		expect(firstAfter.y, "the first playlist, scrolled up").toBeLessThan(
			firstBefore.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await expect(sheet).toBeVisible();
	});
});

// The list a finger has already scrolled is the one a tap on the scrim reached through to: once the
// scrim stops taking pointers on its way out, a browser hit-tests the tap's click again and finds
// the row under it.
const SCROLLED_PX = 240;

test.describe("a row's action sheet closes on its scrim", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"a sheet is the compact shape, and this is touch",
	);
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"a finger is driven through CDP",
	);

	test("on a list touched before, a tap on the scrim over another row closes the sheet, plays nothing and moves no cursor", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const first = (await trackRow(page, 3).boundingBox())!;
		const from = {
			x: first.x + first.width / 2,
			y: first.y + first.height / 2,
		};
		await touchDrag(page, from, { x: from.x, y: from.y - SCROLLED_PX }, 8);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

		const held = trackRow(page, 10);
		await pressAndHold(page, held);
		const sheet = page.getByRole("dialog");
		await expect(sheet).toBeVisible();
		const top = (await restingBox(sheet)).y;

		let target: { index: number; x: number; y: number } | null = null;
		for (let index = 4; index < 10 && !target; index++) {
			const box = await trackRow(page, index).boundingBox();
			if (box && box.y > 0 && box.y + box.height < top)
				target = {
					index,
					x: box.x + box.width / 2,
					y: box.y + box.height / 2,
				};
		}
		expect(target, "a row above the sheet, under its scrim").not.toBeNull();
		const under = trackRow(page, target!.index);

		await page.touchscreen.tap(target!.x, target!.y);

		await expect(sheet).toHaveCount(0);
		await expect(under).toHaveAttribute("data-cursor", "false");
		await expectSettlesAt(player, () => playRequests(player), []);
	});
});

// The smallest target a fingertip lands on reliably.
const FINGER_PX = 44;

// The tile the title stands beside.
const SHEET_HEADER_TILE_PX = 40;

const fontSizeOf = (target: Locator) =>
	target.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).fontSize),
	);

test.describe("a row's action sheet is drawn for a phone", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"a sheet is the compact shape, and these are its proportions",
	);

	test("every action in a row's sheet is tall enough for a finger", async ({
		page,
	}) => {
		const sheet = await openRowSheet(page);
		await restingBox(sheet);

		const actions = sheet.getByRole("menuitem");
		await expect(actions.first()).toBeVisible();
		const heights = await actions.evaluateAll((items) =>
			items.map((item) => item.getBoundingClientRect().height),
		);

		expect(heights.length, "actions in the sheet").toBeGreaterThan(1);
		expect(Math.min(...heights)).toBeGreaterThanOrEqual(FINGER_PX);
	});

	test("a row's sheet is headed by the track's title beside its tile, in type no smaller than its actions", async ({
		page,
	}) => {
		const sheet = await openRowSheet(page);
		await restingBox(sheet);

		const title = sheet.getByText(FIRST_TITLE, { exact: true });
		await expect(title).toBeVisible();
		expect(await fontSizeOf(title)).toBeGreaterThanOrEqual(
			await fontSizeOf(sheet.getByRole("menuitem").first()),
		);

		// The header has no role of its own, so it is read as the innermost box holding the title.
		const header = sheet
			.locator("div")
			.filter({ has: page.getByText(FIRST_TITLE, { exact: true }) })
			.last();
		const box = await restingBox(header);
		const titleBox = await restingBox(title);
		expect(
			titleBox.x - box.x,
			"the title's distance from the header's edge",
		).toBeGreaterThan(SHEET_HEADER_TILE_PX);
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
			() => player.requests.filter((entry) => isTransportCommand(entry.path)),
			[],
		);
	});
});

test.describe("an install that will not let Jean change playlists", () => {
	test.use({ fooJean: { canWritePlaylists: false } });

	// The label's own text, not the row's: `Library` is inside `#Jean Library`,
	// which the user owns and Jean draws.
	const playlistRow = (page: Page, title: string) =>
		sidebar(page)
			.locator("> div")
			.filter({ has: page.getByText(title, { exact: true }) });

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

test.describe("an install whose component allows playlist edits", () => {
	// Filing a row goes to foo_jean, so the item carries no reason: the only
	// setting that can refuse it is the player owner's, held by the component,
	// and this install has not set it.
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

// The cursor is an index in state and no row takes focus, so the keyboard's way to a row's menu is
// a binding that opens it at the cursor row, not the browser's own `contextmenu`. Three spellings,
// since a Mac has no Menu key and fires nothing for Shift+F10.
test.describe("the row menu from the keyboard", () => {
	const cursorRow = (page: Page) =>
		page.locator('[role="row"][data-cursor="true"]');
	const BESIDE_PX = 48;

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await expect(cursorRow(page)).toHaveAttribute("data-row", "2");
		await expect(cursorRow(page)).toHaveAttribute("aria-haspopup", "menu");
	});

	for (const key of ["Shift+F10", "ContextMenu", "ControlOrMeta+Shift+\\"]) {
		test(`${key} opens the cursor row's menu, and Escape closes it with the cursor where it was`, async ({
			page,
		}) => {
			await page.keyboard.press(key);

			const menu = page
				.locator("body > div")
				.filter({ has: menuItem(page, "Add to playlist") });
			await expect(menu).toContainText("Deléctrico");
			await expect(menuItem(page, "Add to queue")).toBeVisible();
			await expect(menuItem(page, "Add to playlist")).toBeVisible();

			await page.keyboard.press("Escape");
			await expect(menuItem(page, "Add to playlist")).toHaveCount(0);
			await expect(cursorRow(page)).toHaveAttribute("data-row", "2");
		});
	}

	test("a selection goes with the cursor, as it does under a right-click", async ({
		page,
	}) => {
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(3);

		await page.keyboard.press("Shift+F10");
		await expect(page.getByText("3 tracks")).toBeVisible();
	});

	test("the menu opens beside the row rather than wherever the pointer last was", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a compact viewport draws the menu as a sheet, anchored to nothing",
		);

		await page.keyboard.press("Shift+F10");
		await expect(menuItem(page, "Add to playlist")).toBeVisible();
		const row = await cursorRow(page).boundingBox();
		// The panel rather than the `menu` role inside it, which sits under the header.
		const menu = await page
			.locator("body > div")
			.filter({ has: menuItem(page, "Add to playlist") })
			.boundingBox();
		expect(row).not.toBeNull();
		expect(menu).not.toBeNull();
		if (!row || !menu) return;

		// Opened at the row's lower left; a flip at the window's edge puts the menu's far edge there
		// instead of its near one.
		const anchor = { x: row.x, y: row.y + row.height };
		const nearest = (edges: number[], to: number) =>
			Math.min(...edges.map((edge) => Math.abs(edge - to)));
		expect(nearest([menu.y, menu.y + menu.height], anchor.y)).toBeLessThan(
			BESIDE_PX,
		);
		expect(nearest([menu.x, menu.x + menu.width], anchor.x)).toBeLessThan(
			BESIDE_PX,
		);
	});

	// With the cursor row scrolled out, the key scrolls to it and the menu waits for the row to be
	// drawn. Rows that change in between must drop that wait, or the menu opens on whatever track
	// takes the index next. Delete removes a row in the same tick, ahead of the frame that would draw
	// it, so the two keys go in one synchronous script; two round trips would land after the draw.
	test("a menu asked for a row that is removed before it draws does not open on the row that takes its place", async ({
		page,
	}) => {
		await scrollUntilMounted(page, trackRow(page, 53));
		await expect(trackRow(page, 2)).toHaveCount(0);

		await page.evaluate(() => {
			for (const init of [
				{ key: "F10", code: "F10", shiftKey: true },
				{ key: "Delete", code: "Delete" },
			])
				document.body.dispatchEvent(
					new KeyboardEvent("keydown", {
						...init,
						bubbles: true,
						cancelable: true,
					}),
				);
		});

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "53");
		await expect(trackRow(page, 2)).toBeAttached();
		await expect(page.getByRole("menuitem")).toHaveCount(0);
	});
});
});

// The cursor is an index in state and no row takes focus, so the keyboard's way to a row's menu is
// a binding that opens it at the cursor row, not the browser's own `contextmenu`. Three spellings,
// since a Mac has no Menu key and fires nothing for Shift+F10.
test.describe("the row menu from the keyboard", () => {
	const cursorRow = (page: Page) =>
		page.locator('[role="row"][data-cursor="true"]');
	const BESIDE_PX = 48;

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await expect(cursorRow(page)).toHaveAttribute("data-row", "2");
		await expect(cursorRow(page)).toHaveAttribute("aria-haspopup", "menu");
	});

	for (const key of ["Shift+F10", "ContextMenu", "ControlOrMeta+Shift+\\"]) {
		test(`${key} opens the cursor row's menu, and Escape closes it with the cursor where it was`, async ({
			page,
		}) => {
			await page.keyboard.press(key);

			const menu = page
				.locator("body > div")
				.filter({ has: menuItem(page, "Add to playlist") });
			await expect(menu).toContainText("Deléctrico");
			await expect(menuItem(page, "Add to queue")).toBeVisible();
			await expect(menuItem(page, "Add to playlist")).toBeVisible();

			await page.keyboard.press("Escape");
			await expect(menuItem(page, "Add to playlist")).toHaveCount(0);
			await expect(cursorRow(page)).toHaveAttribute("data-row", "2");
		});
	}

	test("a selection goes with the cursor, as it does under a right-click", async ({
		page,
	}) => {
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(3);

		await page.keyboard.press("Shift+F10");
		await expect(page.getByText("3 tracks")).toBeVisible();
	});

	test("the menu opens beside the row rather than wherever the pointer last was", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a compact viewport draws the menu as a sheet, anchored to nothing",
		);

		await page.keyboard.press("Shift+F10");
		await expect(menuItem(page, "Add to playlist")).toBeVisible();
		const row = await cursorRow(page).boundingBox();
		// The panel rather than the `menu` role inside it, which sits under the header.
		const menu = await page
			.locator("body > div")
			.filter({ has: menuItem(page, "Add to playlist") })
			.boundingBox();
		expect(row).not.toBeNull();
		expect(menu).not.toBeNull();
		if (!row || !menu) return;

		// Opened at the row's lower left; a flip at the window's edge puts the menu's far edge there
		// instead of its near one.
		const anchor = { x: row.x, y: row.y + row.height };
		const nearest = (edges: number[], to: number) =>
			Math.min(...edges.map((edge) => Math.abs(edge - to)));
		expect(nearest([menu.y, menu.y + menu.height], anchor.y)).toBeLessThan(
			BESIDE_PX,
		);
		expect(nearest([menu.x, menu.x + menu.width], anchor.x)).toBeLessThan(
			BESIDE_PX,
		);
	});

	// With the cursor row scrolled out, the key scrolls to it and the menu waits for the row to be
	// drawn. Rows that change in between must drop that wait, or the menu opens on whatever track
	// takes the index next. Delete removes a row in the same tick, ahead of the frame that would draw
	// it, so the two keys go in one synchronous script; two round trips would land after the draw.
	test("a menu asked for a row that is removed before it draws does not open on the row that takes its place", async ({
		page,
	}) => {
		await scrollUntilMounted(page, trackRow(page, 53));
		await expect(trackRow(page, 2)).toHaveCount(0);

		await page.evaluate(() => {
			for (const init of [
				{ key: "F10", code: "F10", shiftKey: true },
				{ key: "Delete", code: "Delete" },
			])
				document.body.dispatchEvent(
					new KeyboardEvent("keydown", {
						...init,
						bubbles: true,
						cancelable: true,
					}),
				);
		});

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "53");
		await expect(trackRow(page, 2)).toBeAttached();
		await expect(page.getByRole("menuitem")).toHaveCount(0);
	});
});
