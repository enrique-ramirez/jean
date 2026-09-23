import {
	componentOrigin,
	dragTo,
	expect,
	expectSettlesAt,
	type FakePlayer,
	FOO_JEAN_TOKEN,
	globalControls,
	inSequence,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	type Page,
	requestsTo,
	settingsDialog,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";
import { expectPanelOpen, openPanels, panelTab } from "./nowPlaying.ts";

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

	test("is looked at again once when a command meets it first", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		const transport = await globalControls(page, isMobile);
		const play = transport.getByRole("button", { name: "Play", exact: true });
		await expect(play).toBeVisible();

		await page.route(
			`${await componentOrigin(page.request)}/api/playback/play-pause`,
			(route) =>
				route.fulfill({
					status: 401,
					headers: {
						"Access-Control-Allow-Origin": new URL(page.url()).origin,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ error: "authentication required" }),
				}),
		);

		const before = probes(player);
		await play.click();

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

	test.describe("and says so first on the details read", () => {
		const FIZZ_LYRIC = "Sung over the fizz";

		// Each track carries a lyric, so the lyric's own looks at a bare track
		// stay out of the count.
		test.use({
			retagged: {
				"Los Calientes": {
					"%publisher%": "Discos Uno",
					"$meta(unsynced lyrics)": "Uno",
				},
				Fizz: {
					"%publisher%": "Discos Dos",
					"$meta(unsynced lyrics)": FIZZ_LYRIC,
				},
			},
		});

		test("reads the track once more after pairing recovers, and draws it", async ({
			page,
			player,
			isMobile,
		}) => {
			await openLibrary(page);
			await trackRow(page, 0).dblclick();
			await openNowPlaying(page);
			const panel = await openPanels(page, isMobile);
			await panelTab(panel, "Details").click();
			await expectPanelOpen(panel, "Details");
			await expect(panel).toContainText("Discos Uno");

			// Watched inside the panel, frame by frame: a notice that drops while
			// discovery rechecks and returns for the second read is two appearances
			// and a gap, which a poll of the text steps straight over.
			await panel.evaluate(
				(root, { reading, landed }) => {
					const counted = { times: 0, gaps: 0 };
					(window as unknown as { notices: typeof counted }).notices = counted;
					let showing = false;
					let seen = false;
					let done = false;
					new MutationObserver(() => {
						if (done) return;
						const text = (root as HTMLElement).innerText;
						if (landed.some((marker) => text.includes(marker))) {
							done = true;
							return;
						}
						const now = text.includes(reading);
						if (now && !showing) counted.times += 1;
						if (seen && !now) counted.gaps += 1;
						showing = now;
						seen ||= now;
					}).observe(root, {
						childList: true,
						subtree: true,
						characterData: true,
					});
				},
				{ reading: "Reading the tags…", landed: ["Discos Dos", FIZZ_LYRIC] },
			);

			const from = player.requests.length;
			const readsAndRecovery = () => {
				const since = player.requests.slice(from);
				const reads = since.flatMap((entry, at) =>
					entry.method === "GET" && entry.path.includes("/api/track/playing")
						? [at]
						: [],
				);
				const recovered = since.findIndex(
					(entry, at) =>
						at > reads[0] && entry.path.includes("/api/capabilities"),
				);
				return {
					reads: reads.length,
					secondAfterRecovery: recovered >= 0 && reads[1] > recovered,
				};
			};
			Object.assign(player.fooJean, {
				failPlayingTrack: 401,
				playingTrackKnobsFor: 1,
			});

			player.next();
			await expect(async () => {
				await panelTab(panel, "Details").click();
				await expect(panel).toContainText("Discos Dos", { timeout: 1_000 });
			}).toPass();
			await expectSettlesAt(player, readsAndRecovery, {
				reads: 2,
				secondAfterRecovery: true,
			});
			await page.waitForTimeout(3_000);
			expect(readsAndRecovery().reads).toBe(2);
			expect(
				await page.evaluate(
					() => (window as unknown as { notices: object }).notices,
				),
			).toEqual({ times: 1, gaps: 0 });
		});
	});
});

// The poll is refused as well, or its next answer would put the control back
// whether or not the failed command did, and the case would pass either way.
test.describe("a component that hangs up on every command", () => {
	test.use({ fooJeanToken: FOO_JEAN_TOKEN });
	test.skip(
		({ isMobile }) => isMobile,
		"the fader and the seek bar are mouse gestures, and the status bar is where the controls sit side by side",
	);

	const hangUpOnCommands = async (
		page: Page,
		player: FakePlayer,
		drawsThePress: () => Promise<unknown>,
	) => {
		player.fooJean.failState = 503;
		const origin = await componentOrigin(page.request);
		const hungUp: string[] = [];
		await page.route(
			(url) =>
				url.origin === origin &&
				/^\/api\/(playback\/[a-z-]+|volume)$/.test(url.pathname),
			async (route) => {
				const drawn = await drawsThePress().then(
					() => true,
					() => false,
				);
				if (drawn) hungUp.push(new URL(route.request().url()).pathname);
				return route.abort("connectionreset");
			},
		);
		return hungUp;
	};

	const DRAWN = { timeout: 5_000 };

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await expect(
			statusBar(page).getByRole("button", { name: "Shuffle" }),
		).toBeVisible();
	});

	test("Pause goes back to Pause", async ({ page, player }) => {
		await trackRow(page, 0).dblclick();
		const button = (name: string) =>
			statusBar(page).getByRole("button", { name, exact: true });
		await expect(button("Pause")).toBeVisible();
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect(button("Play")).toBeVisible(DRAWN),
		);

		await button("Pause").click();

		await expect.poll(() => hungUp).toContain("/api/playback/play-pause");
		await expect(button("Pause")).toBeVisible();
		expect(player.player.playbackState).toBe("playing");
	});

	test("Shuffle goes back to off", async ({ page, player }) => {
		const shuffle = statusBar(page).getByRole("button", { name: "Shuffle" });
		await expect(shuffle).toHaveAttribute("aria-pressed", "false");
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect(shuffle).toHaveAttribute("aria-pressed", "true", DRAWN),
		);

		await shuffle.click();

		await expect.poll(() => hungUp).toContain("/api/playback/mode");
		await expect(shuffle).toHaveAttribute("aria-pressed", "false");
		expect(player.player.playbackMode).toBe(0);
	});

	test("Mute goes back to Mute", async ({ page, player }) => {
		const button = (name: string) =>
			statusBar(page).getByRole("button", { name, exact: true });
		await expect(button("Mute")).toBeVisible();
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect(button("Unmute")).toBeVisible(DRAWN),
		);

		await button("Mute").click();

		await expect.poll(() => hungUp).toContain("/api/volume");
		await expect(button("Mute")).toBeVisible();
		expect(player.player.volume.isMuted).toBe(false);
	});

	test("the fader goes back to the player's level", async ({
		page,
		player,
	}) => {
		const fader = statusBar(page).getByRole("slider", { name: "Volume" });
		const level = (await fader.getAttribute("aria-valuenow"))!;
		const held = player.player.volume.value;
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect(fader).not.toHaveAttribute("aria-valuenow", level, DRAWN),
		);

		await dragTo(page, fader, 0.1);

		await expect.poll(() => hungUp).toContain("/api/volume");
		await expect(fader).toHaveAttribute("aria-valuenow", level);
		expect(player.player.volume.value).toBe(held);
	});

	test("the seek bar goes back to where the track is", async ({
		page,
		player,
	}) => {
		await trackRow(page, 0).dblclick();
		const bar = statusBar(page).getByRole("slider", {
			name: "Playback position",
		});
		await expect(bar).toHaveAttribute("data-seekable", "true");
		const at = () => bar.getAttribute("aria-valuenow").then(Number);
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect.poll(at, DRAWN).toBeGreaterThan(180),
		);

		await dragTo(page, bar, 0.8, 10);

		await expect.poll(() => hungUp).toContain("/api/playback/seek");
		await expect.poll(at).toBeLessThan(60);
		expect(player.player.activeItem.position).toBeLessThan(60);
	});
});

test.describe("a component that cannot be reached, at the transport", () => {
	test.use({ fooJeanToken: FOO_JEAN_TOKEN, fooJean: { reachable: false } });
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("every command key does nothing, and nothing throws", async ({
		page,
		player,
	}) => {
		const thrown: string[] = [];
		page.on("pageerror", (error) => thrown.push(error.message));
		const before = structuredClone(player.player);

		await openSettings(page);
		await expect(settingsDialog(page)).toContainText("cannot reach it");
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		await inSequence(
			[
				"Space",
				"ControlOrMeta+ArrowRight",
				"ControlOrMeta+ArrowLeft",
				"ControlOrMeta+.",
				"ArrowRight",
				"=",
				"-",
				"m",
			],
			(key) => page.keyboard.press(key),
		);

		await expectSettlesAt(
			player,
			() => ({
				playbackState: player.player.playbackState,
				activeItem: player.player.activeItem,
				volume: player.player.volume,
			}),
			{
				playbackState: before.playbackState,
				activeItem: before.activeItem,
				volume: before.volume,
			},
		);
		expect(thrown).toEqual([]);
	});
});
