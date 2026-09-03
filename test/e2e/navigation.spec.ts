import type { Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	openSidebar,
	requestsTo,
	scrollTo,
	scrollTop,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

const palette = (page: Page) =>
	page.getByRole("dialog", { name: "Go to playlist" });
const paletteField = (page: Page) =>
	page.getByRole("textbox", { name: "Go to playlist" });
const results = (page: Page) => palette(page).getByRole("option");

test.describe("the command palette", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"it is opened and driven entirely by keys",
	);

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		// A bare letter: Mod+Shift+P opens a private window in Firefox and its
		// derivatives, and the browser wins that one.
		await page.keyboard.press("g");
		await expect(palette(page)).toBeVisible();
	});

	test("it opens with the field ready and every playlist listed", async ({
		page,
	}) => {
		await expect(paletteField(page)).toBeFocused();
		// The fixture's four user playlists plus the autoplaylist; `#Jean Library`
		// is the only one held back.
		await expect(results(page)).toHaveCount(5);
		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("typing narrows it and Enter goes there", async ({ page }) => {
		await paletteField(page).fill("fav");
		await expect(results(page)).toHaveCount(1);

		await page.keyboard.press("Enter");

		await expect(palette(page)).toHaveCount(0);
		await expect(
			page.getByRole("heading", { level: 1, name: "Favorites" }),
		).toBeVisible();
	});

	test("the arrows move the choice and Enter takes it", async ({ page }) => {
		await page.keyboard.press("ArrowDown");
		await expect(results(page).nth(1)).toHaveAttribute("aria-selected", "true");

		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("clicking a result goes there too", async ({ page }) => {
		await results(page).filter({ hasText: "Rock en Español" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
	});

	test("typing without the accents still finds the playlist", async ({
		page,
	}) => {
		await paletteField(page).fill("espanol");

		await expect(results(page)).toHaveCount(1);
		await expect(results(page).first()).toContainText("Rock en Español");
	});

	test("every word has to match, in any order", async ({ page }) => {
		await paletteField(page).fill("espanol rock");
		await expect(results(page)).toHaveCount(1);
	});

	test("it says so when nothing matches, rather than showing an empty box", async ({
		page,
	}) => {
		await paletteField(page).fill("zzzz");
		await expect(results(page)).toHaveCount(0);
		await expect(palette(page)).toContainText("No playlist matches that.");
	});

	test("Escape closes it and changes nothing", async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});
});

// beefweb has no library API, so "the library" is whichever playlist the user
// points Jean at.
test.describe("the first run, with no library playlist", () => {
	// The setup screen exists only for a player with no media library API and no
	// autoplaylist to fall back on.
	test.use({ withoutLibraryPlaylist: true, library: { supported: false } });

	test("it names the exact strings to type", async ({ page }) => {
		await page.goto("/#/search");

		await expect(
			page.getByRole("heading", {
				level: 1,
				name: /Point Jean at your library/,
			}),
		).toBeVisible();

		// `getByText` is a case-insensitive substring match, so plain 'ALL' also
		// finds the word "called" in the prose below.
		await expect(
			page.locator("code").filter({ hasText: /^ALL$/ }),
		).toBeVisible();
		await expect(
			page.locator("code").filter({ hasText: /^#Jean Library$/ }),
		).toBeVisible();

		await expect(
			page.getByText("Nothing here creates, clears or reorders a playlist."),
		).toBeVisible();
	});

	test("a playlist merely called Library is not adopted as one", async ({
		page,
		player,
	}) => {
		// The fixture still has an ordinary playlist titled 'Library'.
		expect(player.playlists.some((entry) => entry.title === "Library")).toBe(
			true,
		);

		await page.goto("/#/search");
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: /Point Jean at your library/,
			}),
		).toBeVisible();

		await expect(page.getByRole("listitem")).toHaveCount(0);
	});

	test("it offers to rename the one you probably meant, and then search works", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");

		await page
			.getByRole("button", { name: /Rename it to #Jean Library/ })
			.click();

		await page.getByLabel("Search your library").fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();

		// Renamed, not copied.
		expect(requestsTo(player, "/playlists/add")).toHaveLength(0);
		expect(
			player.playlists.some((entry) => entry.title === "#Jean Library"),
		).toBe(true);
		expect(player.playlists.some((entry) => entry.title === "Library")).toBe(
			false,
		);

		// The name is on the player rather than in this browser, so it survives a
		// reload and holds on the next device too.
		await page.reload();
		await page.getByLabel("Search your library").fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /Point Jean at your library/ }),
		).toHaveCount(0);
	});
});

test.describe("the library playlist is Jean's, not furniture", () => {
	test("it is not in the sidebar, not in the palette, and not somewhere a route lands", async ({
		page,
		player,
	}) => {
		expect(
			player.playlists.some((entry) => entry.title === "#Jean Library"),
		).toBe(true);

		await page.goto("/#/p7");
		await openSidebar(page);
		await expect(sidebar(page).getByText("#Jean Library")).toHaveCount(0);
		// The ordinary playlist that merely shares the word is still right there.
		await expect(
			sidebar(page)
				.getByRole("button")
				.filter({ hasText: /^Library/ }),
		).toHaveCount(1);

		// p8 is `#Jean Library`, and routing to it lands somewhere else.
		await page.goto("/#/p8");
		await expect(
			page.getByRole("heading", { level: 1, name: "#Jean Library" }),
		).toHaveCount(0);
	});
});

test.describe("where a view puts you when you come back to it", () => {
	test("a playlist remembers where it was left", async ({ page }) => {
		await openLibrary(page);
		await scrollTo(page, 900);
		await expect.poll(() => scrollTop(page)).toBe(900);

		await openSidebar(page);
		await sidebar(page)
			.getByRole("button")
			.filter({ hasText: "Favorites" })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Favorites" }),
		).toBeVisible();

		await expect.poll(() => scrollTop(page)).toBe(0);

		await openSidebar(page);
		await sidebar(page)
			.getByRole("button")
			.filter({ hasText: "Library" })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		// Rows arrive a chunk at a time, so the content is often too short to hold
		// the offset at the moment the view comes back; the restore keeps trying
		// for about a second.
		await expect.poll(() => scrollTop(page)).toBe(900);
	});
});

test.describe("chrome that only means something with a keyboard", () => {
	test("the shortcuts button is there on a pointer and gone on touch", async ({
		page,
	}, info) => {
		await page.goto("/");
		const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts" });

		// A pointer question rather than a width one: a narrow desktop window still
		// has a keyboard.
		await expect(shortcuts).toBeVisible({
			visible: info.project.name !== "mobile",
		});
	});
});
