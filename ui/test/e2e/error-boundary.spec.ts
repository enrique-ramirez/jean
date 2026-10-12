import type { ConsoleMessage } from "@playwright/test";

import type { Page } from "./fixtures.ts";
import { expect, statusBar, test } from "./fixtures.ts";

// A throw during render used to unmount the root and leave a page with nothing on it and nothing
// to press. No stored value makes Jean throw any more, so the page is broken from outside: while
// one setting holds, the browser's own `Intl.PluralRules` throws, which is the constructor the
// first `t()` of a render builds. That takes the catalogue down along with the app, so the screen
// asserted here is also the one drawn when its own phrases cannot be looked up.

const BREAKING_KEY = "jean.genreOrder";
const DEVICE_ID = "a-device-the-player-knows";
const DEVICE_NAME = "Kitchen tablet";
const FAILURE = "plural rules are broken on this page";

const stored = (page: Page, key: string) =>
	page.evaluate((name) => window.localStorage.getItem(name), key);

const title = (page: Page) =>
	page.getByRole("heading", { name: "Jean hit a problem" });
const reload = (page: Page) => page.getByRole("button", { name: "Reload" });
const reset = (page: Page) =>
	page.getByRole("button", { name: "Reset this device's settings" });

test.describe("a render that throws", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(
			({ breakingKey, deviceId, deviceName, failure }) => {
				// Seeded once per tab: an init script runs again on every load, and a reset that was
				// seeded over would prove nothing.
				if (!window.sessionStorage.getItem("spec.seeded")) {
					window.sessionStorage.setItem("spec.seeded", "true");
					window.localStorage.setItem(breakingKey, JSON.stringify("largest"));
					window.localStorage.setItem(
						"jean.deviceId",
						JSON.stringify(deviceId),
					);
					window.localStorage.setItem(
						"jean.deviceName",
						JSON.stringify(deviceName),
					);
					window.sessionStorage.setItem("jean.session.raised", "[]");
				}

				Object.defineProperty(Intl, "PluralRules", {
					value: new Proxy(Intl.PluralRules, {
						construct(target, args) {
							if (window.localStorage.getItem(breakingKey) !== null)
								throw new Error(failure);
							return Reflect.construct(target, args);
						},
					}),
				});
			},
			{
				breakingKey: BREAKING_KEY,
				deviceId: DEVICE_ID,
				deviceName: DEVICE_NAME,
				failure: FAILURE,
			},
		);
	});

	test("says what happened and what to do, with the keyboard on Reload", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(title(page)).toBeVisible();
		await expect(page.getByRole("alert")).toContainText(
			"Something on this page failed to draw. Reloading usually fixes it.",
		);
		await expect(reload(page)).toBeFocused();
		await expect(reset(page)).toBeVisible();
		await expect(
			page.getByText(
				"Clears the settings stored in this browser. Your library and playlists live in foobar2000 and are not touched.",
			),
		).toBeVisible();
		// A phone has no console, so the error's own text is on the page too.
		await expect(page.getByText(FAILURE)).toBeVisible();
	});

	test("it is drawn in the theme the reader chose, since the theme effect never ran", async ({
		page,
	}) => {
		await page.addInitScript(() =>
			window.localStorage.setItem("jean.theme", JSON.stringify("light")),
		);

		await page.goto("/");

		await expect(title(page)).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	});

	test("the error reaches the console once, with where in the tree it was thrown", async ({
		page,
	}) => {
		const logged: ConsoleMessage[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") logged.push(message);
		});

		await page.goto("/");
		await expect(title(page)).toBeVisible();

		const records = logged.filter((message) =>
			message.text().includes(FAILURE),
		);
		expect(records).toHaveLength(1);
		// The error's own stack names functions. React's component stack is a second argument, one
		// `at Name` line per component above the throw, and is the half React leaves out of a
		// production build's own log.
		const [, componentStack] = records[0].args();
		expect(await componentStack?.jsonValue()).toMatch(/^\s+at \w+/m);
	});

	test("Reload loads the page again", async ({ page }) => {
		await page.goto("/");
		await expect(title(page)).toBeVisible();
		await page.evaluate(() => {
			(window as Window & { beforeReload?: boolean }).beforeReload = true;
		});

		await reload(page).click();

		await expect
			.poll(() =>
				page.evaluate(
					() => (window as Window & { beforeReload?: boolean }).beforeReload,
				),
			)
			.toBeUndefined();
		// Nothing was cleared, so the same fault draws the same screen.
		await expect(title(page)).toBeVisible();
		expect(await stored(page, BREAKING_KEY)).not.toBeNull();
	});

	test("Reset clears this browser's settings but not who the device is, and the app comes back", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(title(page)).toBeVisible();

		await reset(page).click();

		await expect(statusBar(page)).toBeVisible();
		await expect(title(page)).toHaveCount(0);
		expect(await stored(page, BREAKING_KEY)).toBeNull();
		expect(await stored(page, "jean.deviceId")).toBe(JSON.stringify(DEVICE_ID));
		expect(await stored(page, "jean.deviceName")).toBe(
			JSON.stringify(DEVICE_NAME),
		);
		expect(
			await page.evaluate(() =>
				window.sessionStorage.getItem("jean.session.raised"),
			),
		).toBeNull();
	});
});
