import {
	expect,
	type FakePlayer,
	openSettings,
	type Page,
	requestsTo,
	settingsDialog,
	test,
} from "./fixtures.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

const pairButton = (page: Page) =>
	settingsDialog(page).getByRole("button", { name: /^Pair$/ });

const pairRequests = (player: FakePlayer) =>
	requestsTo(player, "/api/pair").filter((entry) => entry.method === "POST");

test.describe("pairing a device", () => {
	// Installed, running, and no token stored here yet.
	test.use({ fooJean: { pairingOpen: true } });

	test("one press replaces the whole token", async ({ page, player }) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("Needs token");

		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText("Connected");
		await expect.poll(() => pairRequests(player).length).toBe(1);

		// Stored where a pasted one would be.
		const stored = await page.evaluate(() =>
			window.localStorage.getItem("jean.fooJeanToken"),
		);
		expect(JSON.parse(stored ?? '""')).toBe(TOKEN);
	});

	test("nothing has to be typed", async ({ page, player }) => {
		await openSettings(page);
		await pairButton(page).click();
		await expect(settingsDialog(page)).toContainText("Connected");

		const sent = pairRequests(player)[0];
		expect(sent.body).toEqual({});
	});

	test("a name is carried when there is one", async ({ page, player }) => {
		await openSettings(page);
		await settingsDialog(page)
			.getByPlaceholder("This device (optional)")
			.fill("Living room TV");
		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText("Connected");
		expect(pairRequests(player)[0].body).toEqual({ name: "Living room TV" });
	});

	test("the token never reaches the player's own settings namespace", async ({
		page,
		player,
	}) => {
		await openSettings(page);
		await pairButton(page).click();
		await expect(settingsDialog(page)).toContainText("Connected");

		// beefweb serves clientconfig unauthenticated, so syncing the credential
		// through it would recreate the escalation the credential prevents.
		const written = requestsTo(player, "/api/clientconfig").filter(
			(entry) => entry.method === "POST",
		);
		expect(written).toEqual([]);

		for (const entry of player.requests)
			expect(entry.path).not.toContain(TOKEN);
	});

	test("the paste path is still there for anyone who wants it", async ({
		page,
	}) => {
		await openSettings(page);
		await expect(
			settingsDialog(page).getByPlaceholder("Paste the token from foobar2000"),
		).toBeVisible();
	});
});

test.describe("when no window is open", () => {
	// The common case: Pair pressed here before it was pressed on the player.
	test.use({ fooJean: {} });

	test("it says which button to press, by menu path", async ({ page }) => {
		await openSettings(page);
		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText(
			"No pairing window is open",
		);
		await expect(settingsDialog(page)).toContainText(
			"File → Preferences → Tools → Jean",
		);

		await expect(settingsDialog(page)).toContainText("Needs token");
	});

	test("pressing again after the window opens works", async ({
		page,
		player,
	}) => {
		await openSettings(page);
		await pairButton(page).click();
		await expect(settingsDialog(page)).toContainText("No pairing window");

		// Somebody walks to the player and presses the button.
		player.fooJean.pairingOpen = true;

		await pairButton(page).click();
		await expect(settingsDialog(page)).toContainText("Connected");
		await expect.poll(() => pairRequests(player).length).toBe(2);
	});
});

test.describe("a caller outside the local network", () => {
	test.use({
		fooJean: {
			failPairing: 403,
			pairingError: "pairing is available on the local network only",
		},
	});

	test("is told so, rather than told to press a button", async ({ page }) => {
		await openSettings(page);
		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText(
			"not on the player’s own network",
		);
		await expect(settingsDialog(page)).toContainText("Paste the token instead");
	});
});

test.describe("a component too old to pair", () => {
	test.use({ fooJean: { failPairing: 404 } });

	test("says so instead of failing silently", async ({ page }) => {
		await openSettings(page);
		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText("too old to pair");
	});
});

test.describe("too many attempts", () => {
	test.use({ fooJean: { failPairing: 429 } });

	test("reads as a wait rather than as a fault", async ({ page }) => {
		await openSettings(page);
		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText("Wait a few seconds");
	});
});

test.describe("with no component at all", () => {
	test("there is nothing to pair with and nothing is offered", async ({
		page,
	}) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("Not installed");
		await expect(pairButton(page)).toHaveCount(0);
	});
});

test.describe("a component that is advertised but unreachable", () => {
	// The port never answered `/api/status`, so it was never proven to be
	// foo_jean, and the advertisement that named it is forgeable.
	test.use({ fooJean: { reachable: false } });

	test("is not offered a pair button either", async ({ page }) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("cannot reach it");
		await expect(pairButton(page)).toHaveCount(0);
	});
});

test.describe("something else answering on the advertised port", () => {
	test.use({ fooJean: { agentName: "not_foo_jean" } });

	test("is never posted to", async ({ page, player }) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("is not foo_jean");
		await expect(pairButton(page)).toHaveCount(0);
		expect(pairRequests(player)).toEqual([]);
	});
});
