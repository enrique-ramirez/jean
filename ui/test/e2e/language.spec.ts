import type { Page } from "./fixtures.ts";
import { expect, openSettings, test } from "./fixtures.ts";

// English is compiled into the bundle and every other language is a file the
// browser fetches, so the two halves fail differently and both are here.
//
// Nothing below names an element by its label. Every label is what this feature
// changes, so a spec that asked for one would pass by finding an app that had
// not translated and fail on one that had.

const chooser = (page: Page) => page.locator("#language-choice");
const dialog = (page: Page) => page.getByRole("dialog");

const pick = async (page: Page, value: string) => {
	await openSettings(page);
	await chooser(page).selectOption(value);
};

test.describe("choosing a language", () => {
	test("offers what is installed, each language named in itself", async ({
		page,
	}) => {
		await openSettings(page);

		await expect(chooser(page).getByRole("option")).toHaveText([
			"Match my browser",
			"English",
			"Español",
		]);
	});

	test("picking one translates the app around you, without a reload", async ({
		page,
	}) => {
		await openSettings(page);
		await expect(dialog(page)).toContainText("Playback");

		await chooser(page).selectOption("es");

		await expect(dialog(page)).toContainText("Reproducción");
		await expect(page.locator("html")).toHaveAttribute("lang", "es");
	});

	test("the choice survives a reload, and reaches the views behind it", async ({
		page,
	}) => {
		await pick(page, "es");
		await page.reload();

		await expect(page.locator("html")).toHaveAttribute("lang", "es");
		await expect(page.locator("main")).toContainText("canciones");
	});

	test("going back to the browser's language leaves nothing behind", async ({
		page,
	}) => {
		await pick(page, "es");
		await expect(dialog(page)).toContainText("Idioma");

		await chooser(page).selectOption("");

		await expect(dialog(page)).toContainText("Language");
		await expect(page.locator("html")).toHaveAttribute("lang", "en");
	});
});

test.describe("a browser that asks for a language Jean has", () => {
	test.use({ locale: "es-AR" });

	test("opens in it, without anyone choosing", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("html")).toHaveAttribute("lang", "es");
		await expect(page.locator("main")).toContainText("Tu biblioteca");
	});
});

test.describe("a browser that asks for a language Jean does not have", () => {
	test.use({ locale: "cy-GB" });

	test("opens in English rather than in nothing", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("html")).toHaveAttribute("lang", "en");
		await expect(page.locator("main")).toContainText("Your library");
	});
});

// gettext spells a region with an underscore, and a code spelled that way is not a language tag:
// every `Intl` constructor throws for it. With its catalogue installed and the choice stored, the
// first phrase drawn took the whole page with it, on every reload.
test.describe("a stored choice that is not a language tag", () => {
	const UNDERSCORED = "pt_BR";

	test.use({ settings: { "jean.locale": UNDERSCORED } });

	test("opens in the browser's language rather than in nothing", async ({
		page,
	}) => {
		await page.route(`**/locales/${UNDERSCORED}.json`, (route) =>
			route.fulfill({ json: { "home.yourLibrary": "Sua biblioteca" } }),
		);
		await page.goto("/");

		await expect(page.locator("main")).toContainText("Your library");
		await expect(page.locator("html")).toHaveAttribute("lang", "en");
	});
});
