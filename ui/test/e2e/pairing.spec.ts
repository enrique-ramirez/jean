import {
	expect,
	expectSettlesAt,
	type FakePlayer,
	FOO_JEAN_TOKEN,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	type Page,
	requestsTo,
	settingsDialog,
	test,
	trackRow,
} from "./fixtures.ts";

const pairButton = (page: Page) =>
	settingsDialog(page).getByRole("button", { name: /^Pair$/ });

const pairRequests = (player: FakePlayer) =>
	requestsTo(player, "/api/pair").filter((entry) => entry.method === "POST");

// Pairing is what a device does before it holds a token, so none of this is
// reachable from the suite's paired default.
test.use({ fooJeanToken: null });

test.describe("pairing a device", () => {
	test.use({ fooJean: { pairingOpen: true } });

	test("one press replaces the whole token", async ({ page, player }) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("Needs token");

		await pairButton(page).click();

		await expect(settingsDialog(page)).toContainText("Connected");
		await expectSettlesAt(player, () => pairRequests(player).length, 1);

		// Kept, and still working: a reload that comes back connected proves both,
		// where reading the storage key proves neither and names a key the project
		// rules put off limits.
		await page.reload();
		await openSettings(page);
		await expect(settingsDialog(page)).toContainText("Connected");
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
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/clientconfig").filter(
					(entry) => entry.method === "POST",
				),
			[],
		);

		for (const entry of player.requests)
			expect(entry.path).not.toContain(FOO_JEAN_TOKEN);
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

		player.fooJean.pairingOpen = true;

		await pairButton(page).click();
		await expect(settingsDialog(page)).toContainText("Connected");
		await expectSettlesAt(player, () => pairRequests(player).length, 2);
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
	test.use({ fooJean: null });

	test("there is nothing to pair with and nothing is offered", async ({
		page,
	}) => {
		await openSettings(page);

		await expect(settingsDialog(page)).toContainText("Not installed");
		await expect(pairButton(page)).toHaveCount(0);
	});

	// Absent is the component's own answer, so it is asked once. A poll here would
	// be a request every few seconds, for the life of every tab, on every install
	// that does not have the component -- which is most of them.
	test("and the answer is not asked for again", async ({ page, player }) => {
		await openSettings(page);
		await expect(settingsDialog(page)).toContainText("Not installed");

		await page.waitForTimeout(8000);
		expect(requestsTo(player, "/api/clientconfig/foo_jean")).toHaveLength(1);
		expect(requestsTo(player, "/api/status")).toEqual([]);
	});
});

test.describe("a probe that times out once", () => {
	// Installed, running, reachable -- and the first `/api/status` answers only
	// after this device has given up on it.
	test.use({ fooJean: { slowStatus: 1 }, fooJeanToken: FOO_JEAN_TOKEN });

	test("recovers on its own rather than reading as not installed", async ({
		page,
	}) => {
		await openSettings(page);

		// Nothing here presses "Check again": a timeout must not cost the session
		// its component.
		await expect(settingsDialog(page)).toContainText("Connected to foo_jean", {
			timeout: 30_000,
		});
		await expect(settingsDialog(page)).not.toContainText("Not installed");
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
		await expectSettlesAt(player, () => pairRequests(player), []);
	});
});

// The component answers every authenticated route from one token, so a token it
// stops accepting is a fact about the connection rather than about whichever
// route happened to meet it first.
test.describe("a token the component stops accepting", () => {
	test.use({ fooJeanToken: FOO_JEAN_TOKEN });

	const probes = (player: FakePlayer) =>
		requestsTo(player, "/api/clientconfig").filter(
			(entry) => entry.method === "GET",
		).length;

	test("is looked at again once, rather than once a tick", async ({
		page,
		player,
	}) => {
		await openSettings(page);
		await expect(settingsDialog(page)).toContainText("Connected");

		const before = probes(player);
		player.fooJean.failState = 401;

		await expectSettlesAt(player, () => probes(player), before + 1);
	});

	// The read after a timed-out rating is the one request that meets this
	// route, so it is the only way a refusal there can be the first one Jean hears.
	test.describe("and says so first on the read after a timed-out rating", () => {
		test.use({ fooJean: { failWrites: 504, failLibraryTrack: 401 } });

		test("is looked at again once, as a refused poll is", async ({
			page,
			player,
		}) => {
			const readBacks = () =>
				requestsTo(player, "/api/track/library").filter(
					(entry) => entry.method === "GET",
				).length;

			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			await openNowPlaying(page);
			const stars = nowPlayingScreen(page).getByRole("group", {
				name: /stars|Unrated/,
			});
			await expect(stars).toBeVisible();

			const before = probes(player);
			await stars.getByRole("button", { name: "Rate 4 of 5" }).click();

			await expectSettlesAt(player, () => [readBacks(), probes(player)], [
				1,
				before + 1,
			]);
		});
	});
});
