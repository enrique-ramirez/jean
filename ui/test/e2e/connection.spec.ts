import type { Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openSettings,
	playFirstRow,
	settingsDialog,
	test,
} from "./fixtures.ts";

const PREFERENCES = "File → Preferences → Tools → Jean";

const panel = (page: Page) =>
	settingsDialog(page).getByRole("region", { name: "foo_jean" });

// Whatever the suite seeds, this is a browser that has never held a credential.
const asAFreshDevice = (page: Page) =>
	page.addInitScript(() => {
		for (const key of Object.keys(window.localStorage))
			if (/token/i.test(key)) window.localStorage.removeItem(key);
	});

test.describe("a session against foo_jean", () => {
	test("sends no Authorization header on any request", async ({
		page,
		player,
		isMobile,
	}) => {
		const carried: string[] = [];
		page.on("request", (request) => {
			void request.headerValue("authorization").then((value) => {
				if (value !== null)
					carried.push(`${request.method()} ${request.url()}`);
			});
		});

		await playFirstRow(page, isMobile);
		await openSettings(page);
		await expect(panel(page)).toContainText("Connected to foo_jean.");

		await expectSettlesAt(player, () => [...carried], []);
	});

	test("reaches the player from a device holding nothing, and stores no credential", async ({
		page,
		isMobile,
	}) => {
		await asAFreshDevice(page);

		await openSettings(page);
		await expect(panel(page)).toContainText("Connected to foo_jean.");
		await page.getByRole("button", { name: "Close settings" }).click();
		await playFirstRow(page, isMobile);

		const keys = await page.evaluate(() => Object.keys(window.localStorage));
		expect(keys.filter((key) => /token|credential|secret/i.test(key))).toEqual(
			[],
		);
	});

	test("Settings draws no pairing control and asks for no token", async ({
		page,
	}) => {
		await asAFreshDevice(page);

		await openSettings(page);
		await expect(panel(page)).toBeVisible();
		await expect(panel(page)).not.toContainText("Checking…");

		const dialog = settingsDialog(page);
		await expect(dialog.getByRole("button", { name: /pair/i })).toHaveCount(0);
		await expect(dialog.getByLabel(/token/i)).toHaveCount(0);
		await expect(dialog).not.toContainText(/\b(pair|pairing|token)\b/i);
	});
});

test.describe("what Settings says about foo_jean", () => {
	test.beforeEach(async ({ page }) => {
		await asAFreshDevice(page);
	});

	test("ready: says it is connected, with nothing to fix", async ({ page }) => {
		await openSettings(page);

		await expect(panel(page)).toContainText("Connected to foo_jean.");
		await expect(
			panel(page).getByRole("button", { name: "Check again" }),
		).toHaveCount(0);
	});

	test("checking: says so until the component answers, then settles on ready", async ({
		page,
		player,
	}) => {
		player.fooJean.hangCapabilities = true;

		await openSettings(page);
		await expect(panel(page)).toContainText("Checking…");
		await expect(panel(page)).not.toContainText("Connected");

		player.fooJean.hangCapabilities = false;
		await expect(panel(page)).toContainText("Connected to foo_jean.");
	});

	test.describe("unreachable", () => {
		test.use({ fooJean: { reachable: false } });

		test("says the component is not answering, what to check, and offers to try again", async ({
			page,
		}) => {
			await openSettings(page);

			await expect(panel(page)).toContainText("Not connected");
			await expect(panel(page)).toContainText(
				"foo_jean is not answering right now.",
			);
			await expect(panel(page)).toContainText(
				"Check that foobar2000 is still running, then try again.",
			);
			await expect(
				panel(page).getByRole("button", { name: "Check again" }),
			).toBeVisible();
		});
	});

	test.describe("ready with no fields", () => {
		test.use({ fooJean: { allowedFields: [] } });

		test("says nothing may be written, and where in foobar2000 to permit a field", async ({
			page,
		}) => {
			await openSettings(page);

			await expect(panel(page)).toContainText(
				"Connected, and this install permits no fields to be written.",
			);
			await expect(panel(page)).toContainText(PREFERENCES);
		});
	});

	test.describe("with no stream", () => {
		test.use({ fooJean: { canStream: false } });

		test("says this device cannot play the player's audio, and where to look", async ({
			page,
		}) => {
			await openSettings(page);

			await expect(panel(page)).toContainText("Connected to foo_jean.");
			await expect(panel(page)).toContainText(
				"does not stream audio, so Jean cannot play it on this device",
			);
			await expect(panel(page)).toContainText(PREFERENCES);
		});
	});
});
