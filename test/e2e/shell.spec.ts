import type { Page } from "./fixtures.ts";
import { expect, openLibrary, test } from "./fixtures.ts";

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
		await expect.poll(() => overflow(page)).toBe(0);

		// A query fills the field's trailing slot with a count and a clear button,
		// which is the state that pushed the top bar past the screen.
		await page.getByLabel("Search your library").fill("a");
		await expect(page.getByText(/matches?$/)).toBeVisible();

		await expect.poll(() => overflow(page)).toBe(0);
	});
});
