import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	inSequence,
	nowPlayingScreen,
	openLibrary,
	requestsTo,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

// One test per binding in keymap.ts: `useKeymap` registers only the ids a scope
// both declares and has a handler for, so a deleted handler leaves the shortcut
// in the help sheet, documented and dead.
//
// Bindings covered elsewhere:
//
//   /  ArrowUp/Down  Enter  Escape   finder.spec.ts   (the finder's own scope)
//   n                                follow.spec.ts   (jump to playing)
//   l  d  a                          now-playing.spec.ts (the panels they open)
//   h                                heat.spec.ts     (and finder.spec, where
//                                                      it must NOT fire)
//   Mod+Shift+p                      search-playback.spec.ts
//   Alt+ArrowDown                    sidebar.spec.ts  (against a real reorder)
//
// Mod is spelled ControlOrMeta rather than Meta: @tanstack/react-hotkeys and
// Playwright both map Mod by platform, so the literal would pass here and fail
// on Linux.

const searchField = (page: Page) => page.getByLabel("Search your library");
const sidebarLink = (page: Page, title: string) =>
	sidebar(page).getByRole("button").filter({ hasText: title });

const paths = (player: FakePlayer, fragment: string) =>
	requestsTo(player, fragment).map((entry) => entry.path);

test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

test.describe("playback", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("Space plays and pauses", async ({ page, player }) => {
		// Focus is on the body: Space on a focused button activates the button
		// instead.
		await page.keyboard.press("Space");
		await expect
			.poll(() => paths(player, "/player/play-pause"))
			.toHaveLength(1);
	});

	test("Mod with the horizontal arrows changes track", async ({
		page,
		player,
	}) => {
		await page.keyboard.press("ControlOrMeta+ArrowRight");
		await expect.poll(() => paths(player, "/player/next")).toHaveLength(1);

		await page.keyboard.press("ControlOrMeta+ArrowLeft");
		await expect.poll(() => paths(player, "/player/previous")).toHaveLength(1);
	});

	test("Mod+. stops", async ({ page, player }) => {
		await page.keyboard.press("ControlOrMeta+.");
		await expect.poll(() => paths(player, "/player/stop")).toHaveLength(1);
	});

	test("the bare horizontal arrows seek instead", async ({ page, player }) => {
		// Only the vertical pair moves the list cursor, which is what leaves these
		// two free.
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");

		await expect
			.poll(() =>
				requestsTo(player, "/api/player").filter(
					(entry) => entry.body?.relativePosition,
				),
			)
			.toHaveLength(2);

		const seeks = requestsTo(player, "/api/player")
			.map((entry) => entry.body?.relativePosition)
			.filter((value) => value !== undefined);
		expect(seeks).toEqual([5, -5]);
		expect(paths(player, "/player/next")).toHaveLength(0);
		expect(paths(player, "/player/previous")).toHaveLength(0);
	});

	test("= and - move the volume", async ({ page, player }) => {
		// Known and unfixed: on Spanish, French and German layouts '=' is Shift+0,
		// the matcher compares modifier state strictly, and the fallback to
		// event.code finds Digit0 rather than Equal, so volume up is unreachable
		// there. The test asserts the layout it can drive.
		await page.keyboard.press("=");
		await expect.poll(() => paths(player, "/player/volume/up")).toHaveLength(1);

		await page.keyboard.press("-");
		await expect
			.poll(() => paths(player, "/player/volume/down"))
			.toHaveLength(1);
	});

	test("m mutes and unmutes", async ({ page, player }) => {
		await page.keyboard.press("m");
		await expect.poll(() => player.player.volume.isMuted).toBe(true);

		await page.keyboard.press("m");
		await expect.poll(() => player.player.volume.isMuted).toBe(false);
	});
});

test.describe("navigation and appearance", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("Mod+K puts the cursor in the library search", async ({ page }) => {
		await expect(searchField(page)).not.toBeFocused();
		await page.keyboard.press("ControlOrMeta+k");

		// Mod+K searches the whole library; '/' filters the list on screen.
		await expect(searchField(page)).toBeFocused();
	});

	test("Mod+B hides the sidebar and brings it back", async ({ page }) => {
		await expect(sidebarLink(page, "Favorites")).toBeVisible();

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeHidden();

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeVisible();
	});

	test("? opens the shortcut sheet", async ({ page }) => {
		// Playwright sends `key: '?'` with shiftKey set, as a browser does on every
		// layout. The binding matches that rather than the physical slash key, which
		// is elsewhere on Dvorak, Spanish and French.
		await page.keyboard.press("Shift+?");
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
		await expect(sheet).toBeVisible();

		// The sheet is rendered from the array the bindings are registered from, so
		// it cannot drift from what fires while it lists every group.
		await inSequence(["Playback", "Navigation", "In a playlist"], (group) =>
			expect(sheet.getByRole("heading", { name: group })).toBeVisible(),
		);

		// The finder's keys are bound and deliberately undocumented.
		await expect(
			sheet.getByRole("heading", { name: "While finding" }),
		).toHaveCount(0);
	});

	test("the sheet draws one keycap per key, not one per chord", async ({
		page,
	}) => {
		await page.keyboard.press("Shift+?");
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });

		// `formatForDisplay` hands back "⌘ K" in one string; two keys are two caps.
		const nextTrack = sheet
			.locator("div")
			.filter({ hasText: /^Next track/ })
			.last();
		await expect(nextTrack.locator("kbd")).toHaveCount(2);

		// `?` is one cap despite being registered under two spellings, for layouts
		// that do and do not shift to reach it.
		const shortcuts = sheet
			.locator("div")
			.filter({ hasText: /^Keyboard shortcuts/ })
			.last();
		await expect(shortcuts.locator("kbd")).toHaveText(["?"]);
	});

	test("w shows what is playing and hides it again", async ({ page }) => {
		await page.keyboard.press("w");
		await expect(nowPlayingScreen(page)).toBeVisible();

		// The hash rather than the element: dismissing navigates at once and takes
		// the exit animation to leave.
		await page.keyboard.press("w");
		await expect(page).toHaveURL(/#\/p7$/);
	});

	test("p goes to what is playing", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		await page.goto("/#/p2");
		await page.keyboard.press("p");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test("t switches the theme", async ({ page }) => {
		const theme = () => page.locator("html").getAttribute("data-theme");
		const before = await theme();

		await page.keyboard.press("t");
		await expect.poll(theme).not.toBe(before);

		await page.keyboard.press("t");
		await expect.poll(theme).toBe(before);
	});
});

test.describe("moving the cursor in a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	// The cursor is an index in state, not DOM focus: the virtualiser unmounts a
	// focused row the moment it scrolls away, and focus would evaporate with it.
	const cursorRow = (page: Page) =>
		page.locator('[role="row"][data-cursor="true"]');
	const cursorAt = async (page: Page, index: number) =>
		expect(cursorRow(page)).toHaveAttribute("data-row", String(index));

	test("the arrows move it, and nothing else has to", async ({ page }) => {
		await cursorAt(page, 0);

		await page.keyboard.press("ArrowDown");
		await cursorAt(page, 1);
		await page.keyboard.press("ArrowDown");
		await cursorAt(page, 2);

		await page.keyboard.press("ArrowUp");
		await cursorAt(page, 1);

		// j is not bound; the arrows are the only spelling.
		await page.keyboard.press("j");
		await cursorAt(page, 1);
	});

	test("Home and End reach both ends", async ({ page }) => {
		await page.keyboard.press("End");
		await cursorAt(page, 53);

		await page.keyboard.press("Home");
		await cursorAt(page, 0);
	});

	test("the page keys move further than one row and stop at the ends", async ({
		page,
	}) => {
		await page.keyboard.press("PageDown");
		const afterPageDown = Number(
			await cursorRow(page).getAttribute("data-row"),
		);
		expect(afterPageDown).toBeGreaterThan(1);

		await page.keyboard.press("PageUp");
		await cursorAt(page, 0);

		await page.keyboard.press("PageUp");
		await cursorAt(page, 0);
	});
});

test.describe("selecting in a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	const selected = (page: Page) =>
		page.locator('[role="row"][data-selected="true"]');

	test("Shift with the arrows extends the selection", async ({ page }) => {
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(selected(page)).toHaveCount(3);

		await page.keyboard.press("Shift+ArrowUp");
		await expect(selected(page)).toHaveCount(2);
	});

	test("clicking away from the rows drops the selection", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");
		await expect(selected(page).first()).toBeVisible();

		// The title stands in for background: with 54 rows the list is taller than
		// the window and there is no empty space under it.
		await page.getByRole("heading", { level: 1 }).click();
		await expect(selected(page)).toHaveCount(0);
	});

	test("a control in the view does not drop it", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");
		const before = await selected(page).count();
		expect(before).toBeGreaterThan(1);

		await page.getByRole("button", { name: "Play-count heat" }).click();
		await expect(selected(page)).toHaveCount(before);
	});

	test("Mod+A takes everything and Escape gives it back", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");

		// Only mounted rows can be counted on screen; the selection itself is a set
		// of indices over all 54.
		const mounted = await page.locator('[role="row"]').count();
		expect(mounted).toBeGreaterThan(1);
		await expect(selected(page)).toHaveCount(mounted);

		await page.keyboard.press("Escape");
		await expect(selected(page)).toHaveCount(0);
	});
});

test.describe("view keys", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("v switches between the compact and album layouts", async ({ page }) => {
		const layout = (name: string) =>
			page.getByRole("button", { name, exact: true });
		await expect(layout("List")).toHaveAttribute("aria-pressed", "true");

		await page.keyboard.press("v");
		await expect(layout("Albums")).toHaveAttribute("aria-pressed", "true");

		// Rows are grouped in the album layout, so the measurements cached by index
		// mean something else entirely.
		await expect(
			page.locator("section").filter({ hasText: "Jessico" }),
		).toBeVisible();

		await page.keyboard.press("v");
		await expect(layout("List")).toHaveAttribute("aria-pressed", "true");
	});
});

test.describe("in search results", () => {
	test("Mod+S offers to save the results as a playlist", async ({ page }) => {
		await page.goto("/#/search");
		await searchField(page).fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();

		// The field has focus straight after typing, and the binding has to fire
		// from there.
		await page.keyboard.press("ControlOrMeta+s");
		await expect(
			page.getByRole("textbox", { name: "Playlist name" }),
		).toBeVisible();
	});
});

test.describe("in the sidebar", () => {
	test("Alt+ArrowUp moves a playlist up", async ({ page, player }) => {
		await openLibrary(page);

		// Registered only while a row holds focus, so arrow keys with a modifier
		// cannot fire while the cursor is in the track list.
		await sidebarLink(page, "Favorites").focus();
		await page.keyboard.press("Alt+ArrowUp");

		await expect
			.poll(() => player.playlists.map((entry) => entry.title).slice(0, 3))
			.toEqual(["Default Playlist", "Favorites", "Library"]);
	});
});
