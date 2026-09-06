import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	nowPlayingScreen,
	openLibrary,
	openSidebar,
	requestsTo,
	scrollTo,
	scrollTop,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

const palette = (page: Page) => page.getByRole("dialog", { name: "Go to" });
const paletteField = (page: Page) =>
	page.getByRole("textbox", { name: "Go to" });
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
		// All music, then the fixture's four user playlists plus the autoplaylist;
		// `#Jean Library` is the only one held back.
		await expect(results(page)).toHaveCount(6);
		await expect(results(page).first()).toHaveText(/^All music/);
		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("the first result stays active under a pointer that has not moved", async ({
		page,
	}) => {
		// Where the third result sits. The palette opens in the same place every
		// time, so parking the pointer there and reopening puts a row under a
		// cursor that never moved -- which is what the palette is normally used
		// like, since it is opened by a key.
		const box = (await results(page).nth(2).boundingBox())!;
		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.keyboard.press("g");
		await expect(results(page)).toHaveCount(6);

		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);

		// And again for a query typed under the same still pointer.
		await paletteField(page).fill("e");
		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("hovering a result still selects it, once the pointer really moves", async ({
		page,
	}) => {
		const target = results(page).nth(3);
		const box = (await target.boundingBox())!;

		// Somewhere else first: the first mouseenter has no earlier position to be
		// compared against and is refused, so one synthetic move onto a row proves
		// nothing either way.
		await page.mouse.move(4, 4);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		await expect(target).toHaveAttribute("aria-selected", "true");
	});

	test("All music is above the playlists and goes there", async ({ page }) => {
		await expect(palette(page)).toContainText("Playlists");

		await paletteField(page).fill("all mus");
		await expect(results(page)).toHaveCount(1);
		// The section is drawn only when the filter left something under it.
		await expect(palette(page)).not.toContainText("Playlists");

		await page.keyboard.press("Enter");
		await expect(palette(page)).toHaveCount(0);
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
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
		// Down the whole panel: the views and the playlists are two sections on screen and one list to the arrows.
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await expect(results(page).nth(2)).toHaveAttribute("aria-selected", "true");

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
		await expect(palette(page)).toContainText("Nothing here matches that.");
	});

	test("Escape closes it and changes nothing", async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});
});

// A playlist can be reached by name and a shelf cannot: it has no permanent row
// anywhere, so the palette borrows one for as long as it is what is playing.
test.describe("the shelf that is playing", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"it is opened and driven entirely by keys",
	);

	test("gets a row above All music, and is not there before it plays", async ({
		page,
	}) => {
		await page.goto("/");
		const explore = page.getByRole("region", { name: "Explore" });
		await expect(explore).toBeVisible();

		await page.keyboard.press("g");
		await expect(results(page)).toHaveCount(6);
		await expect(results(page).first()).toHaveText(/^All music/);
		await page.keyboard.press("Escape");

		// Most played is the tab Explore opens on, so this puts that shelf in play.
		await explore.getByRole("button", { name: /^Jessico/ }).click();
		await expectPlayingFrom(page, "Most played");

		await page.keyboard.press("g");
		await expect(results(page)).toHaveCount(7);
		await expect(results(page).first()).toHaveText(/^Most played/);

		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
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
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/playlists/add").length,
			0,
		);
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

// Far enough down the 54-track fixture to be nowhere near either end.
const LEFT_AT = 900;

// A tolerance rather than equality: row heights, the scroll offset and the
// container's own rect are all fractional, and the phone runs at DPR 2.625.
const expectNear = (page: Page, offset: number) =>
	expect
		.poll(async () => Math.abs((await scrollTop(page)) - offset))
		.toBeLessThan(2);

test.describe("where a view puts you when you come back to it", () => {
	test("a playlist remembers where it was left", async ({ page }) => {
		await openLibrary(page);
		await scrollTo(page, LEFT_AT);
		await expectNear(page, LEFT_AT);

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
		await expectNear(page, LEFT_AT);
	});
});

test.describe("landing on the front door", () => {
	test("with nothing playing it is the front door", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("main")).toBeVisible();
		await expect(nowPlayingScreen(page)).toBeHidden();
	});

	test("with a track loaded it opens that track, over the set it came from", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		// Polled on playback rather than on the click: the set is written to the
		// scratch playlist first and played a round trip later, and a reload before
		// then lands on a player with nothing playing.
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		await page.goto("/");
		await expect(nowPlayingScreen(page)).toBeVisible();
		// The view is drawn under the screen rather than left at home, which is
		// what dismissing lands on.
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeAttached();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test("a playlist is a set too", async ({ page, player }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		await page.goto("/");
		await expect(nowPlayingScreen(page)).toBeVisible();
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("asking for home is not the front door", async ({ page, player }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		// Somewhere the user asked to be, so nothing opens over it.
		await page.goto("/#/home");
		await expect(nowPlayingScreen(page)).toBeHidden();
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
