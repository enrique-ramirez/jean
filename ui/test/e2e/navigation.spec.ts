import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	nowPlayingScreen,
	openLibrary,
	openSidebar,
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

// One row per playlist the player holds, plus All music. Counted off the player
// rather than written down, since a number here is a claim about the fixture and
// what the palette lists is the question.
const everyPlaylistAndAllMusic = (player: FakePlayer) =>
	player.playlists.length + 1;

// Matched on the label's own text rather than on the row's: `Library` is inside
// `#Jean Library`, which the user owns and the sidebar draws.
const sidebarLink = (page: Page, title: string) =>
	sidebar(page)
		.getByRole("button")
		.filter({ has: page.getByText(title, { exact: true }) });

test.describe("the command palette", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"it is opened and driven entirely by keys",
	);

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await page.keyboard.press("g");
		await expect(palette(page)).toBeVisible();
	});

	test("Tab wraps between the field and the last result, and Escape gives focus back to where it was", async ({
		page,
	}) => {
		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);
		await sidebarLink(page, "Home").focus();
		await page.keyboard.press("g");
		await expect(paletteField(page)).toBeFocused();

		await page.keyboard.press("Shift+Tab");
		await expect(results(page).last()).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(paletteField(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);
		await expect(sidebarLink(page, "Home")).toBeFocused();
	});

	test("it opens with the field ready and every playlist listed", async ({
		page,
		player,
	}) => {
		await expect(paletteField(page)).toBeFocused();
		await expect(results(page)).toHaveCount(everyPlaylistAndAllMusic(player));
		await expect(results(page).first()).toHaveText(/^All music/);
		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("the first result stays active under a pointer that has not moved", async ({
		page,
		player,
	}) => {
		const box = (await results(page).nth(2).boundingBox())!;
		await page.keyboard.press("Escape");
		await expect(palette(page)).toHaveCount(0);

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.keyboard.press("g");
		await expect(results(page)).toHaveCount(everyPlaylistAndAllMusic(player));

		await expect(results(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);

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

		await page.mouse.move(4, 4);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		await expect(target).toHaveAttribute("aria-selected", "true");
	});

	test("All music is above the playlists and goes there", async ({ page }) => {
		await expect(palette(page)).toContainText("Playlists");

		await paletteField(page).fill("all mus");
		await expect(results(page)).toHaveCount(1);
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
		player,
	}) => {
		await page.goto("/");
		const explore = page.getByRole("region", { name: "Explore" });
		await expect(explore).toBeVisible();

		const before = everyPlaylistAndAllMusic(player);
		await page.keyboard.press("g");
		await expect(results(page)).toHaveCount(before);
		await expect(results(page).first()).toHaveText(/^All music/);
		await page.keyboard.press("Escape");

		// Most played is the tab Explore opens on, so this puts that shelf in play.
		await explore.getByRole("button", { name: /^Jessico/ }).click();
		await expectPlayingFrom(page, "Most played");

		await page.keyboard.press("g");
		// Exactly one row more than before playing: the shelf borrowed one, and the
		// playlist the component filled to play it is listed nowhere.
		await expect(results(page)).toHaveCount(before + 1);
		await expect(results(page).first()).toHaveText(/^Most played/);

		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();
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
		await sidebarLink(page, "Favorites").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Favorites" }),
		).toBeVisible();

		await expect.poll(() => scrollTop(page)).toBe(0);

		await openSidebar(page);
		await sidebarLink(page, "Library").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library", exact: true }),
		).toBeVisible();

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

		await expect(shortcuts).toBeVisible({
			visible: info.project.name !== "mobile",
		});
	});
});
