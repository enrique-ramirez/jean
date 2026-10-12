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
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

const NARROWEST = { width: 320, height: 640 };

const overflow = (page: Page) =>
	page.evaluate(() => {
		const root = document.documentElement;
		return root.scrollWidth - root.clientWidth;
	});

// Neither the sideways scroll nor the short grid it causes shows above about 400px.
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

test.describe("the status bar's cover", () => {
	test("is smaller on a phone than on a desktop", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);

		const cover = statusBar(page).locator("[data-artwork]");
		const side = isMobile ? "40px" : "44px";
		await expect(cover).toHaveCSS("width", side);
		await expect(cover).toHaveCSS("height", side);
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

		// Nothing to offer until there is somewhere to go, so the chevron and the promise in the label
		// arrive with the scroll and leave with it.
		const named = topBar(page).getByRole("button", { name: /Back to the top/ });
		await expect(named).toHaveCount(0);

		await scrollTo(page, 2000);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

		await expect(named).toBeVisible();
		await named.click();
		await expect.poll(() => scrollTop(page)).toBe(0);
		await expect(named).toHaveCount(0);
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

	test("revealing the search hides the mark and the place, and leaving it empty brings them back", async ({
		page,
	}) => {
		await openLibrary(page);
		const mark = topBar(page).getByRole("link", { name: "jean" });

		await revealSearch(page);
		await expect(searchField(page)).toBeFocused();
		await expect(mark).toHaveCount(0);

		await searchField(page).blur();
		await expect(mark).toBeVisible();
	});

	// The panel's rows are clicked, and a click on one blurs the field on its way there.
	test("a draft keeps the field through a blur", async ({ page }) => {
		await openLibrary(page);
		await revealSearch(page);

		await searchField(page).fill("babasonicos");
		await searchField(page).blur();
		await expect(searchField(page)).toHaveValue("babasonicos");
	});

	test("Escape empties the field and then puts it away", async ({ page }) => {
		await openLibrary(page);
		await revealSearch(page);
		const mark = topBar(page).getByRole("link", { name: "jean" });

		await searchField(page).fill("babasonicos");
		// The rungs, outermost first: the preview, then the edit, then the field itself.
		await searchField(page).press("Escape");
		await searchField(page).press("Escape");
		await searchField(page).press("Escape");

		await expect(mark).toBeVisible();
	});
});

declare global {
	interface Window {
		__refusedByPolicy?: string[];
	}
}

const recordPolicyRefusals = (page: Page) =>
	page.addInitScript(() => {
		const refused: string[] = [];
		window.__refusedByPolicy = refused;
		document.addEventListener("securitypolicyviolation", (event) => {
			refused.push(
				`${event.effectiveDirective} ${event.blockedURI.slice(0, 40)}`,
			);
		});
	});

const refusedByPolicy = (page: Page) =>
	page.evaluate(() => window.__refusedByPolicy);

const tabIcon = (page: Page) =>
	page.evaluate(
		() => document.querySelector<HTMLLinkElement>("link[rel='icon']")?.href,
	);

const ICON_TURNS_WATCHED = 6;

// The fake sends foo_jean's own policy on the page, so anything the policy refuses is refused
// here as it is on an install. The tab's icon is the worked example: it is swapped for every
// frame of a playing record, and a refused one leaves the tab with no icon at all.
test.describe("the page under foo_jean's content policy", () => {
	test("nothing Jean draws is refused, at boot or while a record turns in the tab", async ({
		page,
		player,
	}) => {
		await recordPolicyRefusals(page);
		await openLibrary(page);
		await expect(statusBar(page)).toBeVisible();
		await expect.poll(() => tabIcon(page)).toMatch(/^blob:/);

		player.patchPlayer({ playbackState: "playing" });
		const turns = new Set<string | undefined>();
		await expect
			.poll(async () => turns.add(await tabIcon(page)).size, {
				intervals: [50],
			})
			.toBeGreaterThan(ICON_TURNS_WATCHED);

		expect(await refusedByPolicy(page)).toEqual([]);
	});
});
