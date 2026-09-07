import type { Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	openSettings,
	revealSearch,
	scrollTo,
	scrollTop,
	searchField,
	searchFor,
	test,
	trackRow,
} from "./fixtures.ts";

// 320px, which is the narrowest phone still worth drawing for and the width every
// piece of chrome has to survive.
const NARROWEST = { width: 320, height: 640 };

const overflow = (page: Page) =>
	page.evaluate(() => {
		const root = document.documentElement;
		return root.scrollWidth - root.clientWidth;
	});

// Mechanism and the 400px threshold are in src/app/CLAUDE.md.
test.describe("the shell fits the screen", () => {
	test.skip(({ isMobile }) => !isMobile, "a phone is the case at stake");

	test("nothing in the top bar can widen the document", async ({ page }) => {
		await page.setViewportSize(NARROWEST);
		await openLibrary(page);

		// Polled rather than read on the tick after load, which races first paint.
		// This is the compact bar shut: the brand, the name of the place and two
		// icons, none of which may set a floor the screen cannot meet.
		await expect.poll(() => overflow(page)).toBe(0);

		await revealSearch(page);
		await expect.poll(() => overflow(page)).toBe(0);

		// A query fills the field's trailing slot with a count and a clear button,
		// which is the state that pushed the top bar past the screen.
		await searchField(page).fill("a");
		await expect(page.getByRole("option").first()).toBeVisible();

		// The dropdown is the widest thing the field can put on the screen, so it is
		// measured open as well as shut.
		await expect.poll(() => overflow(page)).toBe(0);

		await searchFor(page, "a");
		await expect(page.getByText(/matches?$/)).toBeVisible();

		await expect.poll(() => overflow(page)).toBe(0);
	});
});

test.describe("the compact top bar", () => {
	test.skip(({ isMobile }) => !isMobile, "the desktop bar has room for it all");

	const topBar = (page: Page) => page.locator("header").first();

	test("the mark is the way home", async ({ page }) => {
		await openLibrary(page);
		await topBar(page).getByRole("link", { name: "jean" }).click();
		await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
	});

	test("the name of the place takes you back to the top of it", async ({
		page,
	}) => {
		await openLibrary(page);
		await expect(trackRow(page, 0)).toBeAttached();

		await scrollTo(page, 2000);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

		await topBar(page)
			.getByRole("button", { name: /Back to the top/ })
			.click();
		await expect.poll(() => scrollTop(page)).toBe(0);
	});

	test("the theme is in Settings rather than in the bar", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openLibrary(page);

		await expect(
			topBar(page).getByRole("button", {
				name: /Switch to (light|dark) theme/,
			}),
		).toHaveCount(0);

		// The colours themselves, as in keyboard.spec.ts: the two custom-property sets are the design,
		// where an attribute on <html> is a flag.
		const surface = () =>
			page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		const followed = await surface();

		await openSettings(page);
		const choice = page.getByLabel("Theme", { exact: true });
		await choice.selectOption("light");
		await expect.poll(surface).not.toBe(followed);

		// And back onto the system's own answer, which is what an install nobody has chosen for shows.
		await choice.selectOption("");
		await expect.poll(surface).toBe(followed);
	});

	test("revealing the search hides the mark and the place, and closing brings them back", async ({
		page,
	}) => {
		await openLibrary(page);
		const mark = topBar(page).getByRole("link", { name: "jean" });

		await revealSearch(page);
		await expect(searchField(page)).toBeFocused();
		await expect(mark).toHaveCount(0);

		await topBar(page).getByRole("button", { name: "Close search" }).click();
		await expect(mark).toBeVisible();
	});
});
