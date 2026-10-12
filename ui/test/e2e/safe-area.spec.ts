import type { Page } from "./fixtures.ts";
import { expect, openLibrary, test, trackRow } from "./fixtures.ts";

// A phone held sideways with its notch on the left: the page runs edge to edge, since
// `index.html` asks for `viewport-fit=cover`.
const LANDSCAPE = { width: 780, height: 360 };
const NOTCH = { top: 0, left: 48, right: 0, bottom: 21 };
const PORTRAIT_NOTCH = { top: 40, left: 0, right: 0, bottom: 21 };

// Chromium's DevTools protocol: `Emulation.setSafeAreaInsetsOverride` sets what `env()` answers.
const emulateSafeArea = async (page: Page, insets: typeof NOTCH) => {
	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
};

const leftOf = async (page: Page, name: string) =>
	(await page.getByRole("button", { name, exact: true }).boundingBox())?.x ??
	-1;

test.describe("a phone with a notch", () => {
	test.skip(({ isMobile }) => !isMobile, "a desktop has no safe area");
	test.use({ settings: { "jean.heatIntroSeen": true } });

	test.describe("held sideways", () => {
		test.use({ viewport: LANDSCAPE });

		test("the top bar, the list and the drawer's rows all start clear of it", async ({
			page,
		}) => {
			await emulateSafeArea(page, NOTCH);
			await openLibrary(page);

			expect(await leftOf(page, "Show playlists")).toBeGreaterThanOrEqual(
				NOTCH.left,
			);
			const row = await trackRow(page, 0).boundingBox();
			expect(row?.x).toBeGreaterThanOrEqual(NOTCH.left);

			await page.getByRole("button", { name: "Show playlists" }).tap();
			const first = page.locator("[data-nav-row]").first();
			await expect(first).toBeVisible();
			expect((await first.boundingBox())?.x).toBeGreaterThanOrEqual(NOTCH.left);
		});
	});

	test("held upright, the top bar and the drawer start under it", async ({
		page,
	}) => {
		await emulateSafeArea(page, PORTRAIT_NOTCH);
		await openLibrary(page);

		const toggle = page.getByRole("button", { name: "Show playlists" });
		expect((await toggle.boundingBox())?.y).toBeGreaterThanOrEqual(
			PORTRAIT_NOTCH.top,
		);

		await toggle.tap();
		const first = page.locator("[data-nav-row]").first();
		await expect(first).toBeVisible();
		expect((await first.boundingBox())?.y).toBeGreaterThanOrEqual(
			PORTRAIT_NOTCH.top,
		);
	});
});
