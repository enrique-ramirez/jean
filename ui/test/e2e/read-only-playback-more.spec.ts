import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	choosePlayer,
	countPostsTo,
	deviceAudio,
	dragFrom,
	dragTo,
	expect,
	expectDisabledWithReason,
	expectNothingOpened,
	expectNothingRefusedSent,
	expectSettlesAt,
	globalControls,
	holdThePoll,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	orderButton,
	playbackOffToast,
	playingOn,
	REASON,
	refusedAsks,
	revealSearch,
	scratchOf,
	searchField,
	searchFor,
	statusBar,
	test,
	touchDrag,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import { openPanels, panelTab, TAGGED } from "./nowPlaying.ts";

const allowPlayback = async (page: Page, canControl: boolean) => {
	const answered = await page.request.post("/__control/controlPlayback", {
		data: { canControl },
	});
	expect(answered.ok(), "the fake needs /__control/controlPlayback").toBe(true);
};

const playingAtThePlayer = async (page: Page, player: FakePlayer) => {
	player.playItem("p7", 2);
	await openLibrary(page);
	await expect(statusBar(page)).toContainText("Deléctrico");
};

const statusBarVolume = (page: Page) =>
	statusBar(page).getByRole("slider", { name: /^Volume\b/ });

const playPause = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^(Play|Pause)\b/ });

const explore = (page: Page) => page.getByRole("region", { name: "Explore" });

const topTracks = (page: Page) =>
	page.getByRole("region", { name: "Your top tracks" });

const suggestedTracks = (page: Page) =>
	page.locator('[role="option"][data-kind="track"]');

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const ARTIST = "Babasónicos";

const openArtist = async (page: Page, name: string) => {
	await openLibrary(page);
	await page.goto(`/#/artist/${encodeURIComponent(name)}`);
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

test.describe("with playback control off at the player", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	test("a Home shelf's album card is disabled with the reason, and pressing it plays nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		const card = explore(page).getByRole("button", { name: /Jessico/ });

		await expectDisabledWithReason(card);

		await card.click({ force: true });
		if (!isMobile) await card.press("Enter");
		await expectNothingRefusedSent(player);
		expect(scratchOf(player)).toBeUndefined();
	});

	test("a top track on Home plays nothing, from a pointer or the keyboard", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		const first = topTracks(page).getByRole("button").first();
		await expect(first).toBeVisible();

		await first.click({ force: true });
		if (!isMobile) {
			await page.goto("/");
			await topTracks(page).getByRole("button").first().press("Enter");
		}
		await expectNothingRefusedSent(player);
	});

	test("an artist's Play and Shuffle stay drawn, disabled with the reason, and pressing them sends nothing", async ({
		page,
		player,
	}) => {
		await openArtist(page, ARTIST);
		const play = viewHeader(page).getByRole("button", { name: /^Play\b/ });
		const shuffle = viewHeader(page).getByRole("button", {
			name: /^Shuffle\b/,
		});

		await expectDisabledWithReason(play);
		await expectDisabledWithReason(shuffle);

		await play.click({ force: true });
		await shuffle.click({ force: true });
		await expectNothingRefusedSent(player);
	});

	test.describe("an artist who is a guest elsewhere", () => {
		test.use({
			retagged: {
				Bloodhail: { "%artist%": `Have a Nice Life feat. ${ARTIST}` },
			},
		});

		test("pressing a track under Appears on plays nothing", async ({
			page,
			player,
		}) => {
			await openArtist(page, ARTIST);
			await expect(
				page.getByRole("heading", { name: "Appears on" }),
			).toBeVisible();

			await page
				.locator("main")
				.getByRole("button", { name: /Bloodhail/ })
				.click({ force: true });

			await expectNothingRefusedSent(player);
		});
	});

	test.describe("a track suggested under the search field", () => {
		const pickable = async (page: Page) => {
			await openLibrary(page);
			await revealSearch(page);
			await searchField(page).fill("babasonicos");
			await expect(suggestedTracks(page).first()).toBeVisible();
		};

		test("chosen with Enter, plays nothing", async ({ page, player }) => {
			await pickable(page);
			await searchField(page).press("ArrowDown");
			await expect(suggestedTracks(page).first()).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await searchField(page).press("Enter");

			await expectNothingRefusedSent(player);
		});

		test("chosen with a click, plays nothing", async ({ page, player }) => {
			await pickable(page);
			await suggestedTracks(page).first().click();

			await expectNothingRefusedSent(player);
		});
	});

	test.describe("the cover wheel on a phone", () => {
		test.skip(
			({ isMobile }) => !isMobile,
			"the wheel is the phone's skip gesture",
		);
		test.use({ motion: "allow" });

		// Under shuffle the next sleeve cannot be known, so a turn holds the title
		// blank until the player answers. A turn that was never sent is never
		// answered, which is what a hold stuck on screen looks like.
		test("a swipe skips nothing, and leaves the playing track named rather than held blank", async ({
			page,
			player,
		}) => {
			await playingAtThePlayer(page, player);
			player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
			await openNowPlaying(page);
			const title = nowPlayingScreen(page).locator("h1");
			await expect(title).toHaveText("Deléctrico");

			await nowPlayingScreen(page).evaluate(async (el) => {
				await Promise.all(el.getAnimations().map((entry) => entry.finished));
			});
			const box = (await nowPlayingScreen(page).boundingBox())!;
			const y = box.y + box.height * 0.4;
			await touchDrag(
				page,
				{ x: box.x + box.width * 0.85, y },
				{ x: box.x + box.width * 0.25, y },
			);

			await expectNothingRefusedSent(player);
			expect(await title.innerText()).toBe("Deléctrico");
		});
	});

	test("the player's fader under Listen here is disabled with the reason, and moving it sends no volume", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		await choosePlayer(page).click();
		const fader = playingOn(page).getByRole("slider", {
			name: /^Volume on foobar2000\b/,
		});

		await expectDisabledWithReason(fader);

		await fader.click({ force: true });
		if (!isMobile) await dragTo(page, fader, 0.6);
		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});

	test("a track dragged over the open queue panel is refused with the reason, and nothing is queued", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");

		await openLibrary(page);
		const queueButton = statusBar(page).getByRole("button", { name: /^Queue/ });
		await queueButton.click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		await dragFrom(page, trackRow(page, 0), queuePanel(page));
		await expect(queueButton).toHaveAttribute("data-drop-target");
		await expect(page.locator("[data-armed]")).toBeVisible();
		await expect(page.locator("[data-refused]")).toHaveText(REASON);
		await page.mouse.up();

		await expectNothingRefusedSent(player);
		expect(player.playQueue).toHaveLength(0);
	});

	test.describe("a line of a timed lyric", () => {
		test.use(TAGGED);

		test("is disabled with the reason, and pressing it seeks nowhere", async ({
			page,
			player,
			isMobile,
		}) => {
			player.playItem("p7", 0);
			await openLibrary(page);
			await expect(statusBar(page)).toContainText("Los Calientes");
			await openNowPlaying(page);
			const panel = await openPanels(page, isMobile);
			await panelTab(panel, "Lyrics").click();
			const line = panel.getByRole("button", { name: /Dancing in the dark/ });

			await expectDisabledWithReason(line);

			await line.click({ force: true });
			await expectNothingRefusedSent(player);
		});
	});
});

test.describe("listening on this device with playback control off at the player", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	const showVolume = (scope: Locator) =>
		scope.getByRole("button", { name: "Show volume" });

	const faderIn = (scope: Locator) =>
		scope.getByRole("slider", { name: /^Volume\b/ });

	const listeningHere = async (page: Page, player: FakePlayer) => {
		await playingAtThePlayer(page, player);
		await listenHere(page);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(choosePlayer(page)).toHaveAccessibleName(
			/Playing on this device/,
		);
		await untilQuiet(player);
		return player.requests.length;
	};

	const pressFromTheBody = async (page: Page, keys: readonly string[]) => {
		// Space on a focused button presses the button.
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		for (const key of keys) await page.keyboard.press(key);
	};

	const slide = async (
		page: Page,
		isMobile: boolean,
		fader: Locator,
		from: number,
		to: number,
	) => {
		const box = (await fader.boundingBox())!;
		const vertical = box.height > box.width;
		const at = (fraction: number) =>
			vertical
				? { x: box.x + box.width / 2, y: box.y + box.height * (1 - fraction) }
				: { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
		if (isMobile) {
			await touchDrag(page, at(from), at(to), 8);
			return;
		}
		await page.mouse.move(at(from).x, at(from).y);
		await page.mouse.down();
		await page.mouse.move(at(to).x, at(to).y, { steps: 10 });
		await page.mouse.up();
	};

	const expectTurnsThisDevice = async (
		page: Page,
		isMobile: boolean,
		fader: Locator,
		from: number,
		to: number,
	) => {
		await expect(fader).toBeVisible();
		await expect(fader).not.toHaveAttribute("aria-disabled", "true");
		await expect(fader).toHaveAccessibleName("Volume on this device");

		const before = (await deviceAudio(page)).volume;
		await slide(page, isMobile, fader, from, to);
		const now = async () => (await deviceAudio(page)).volume;
		if (to < from) await expect.poll(now).toBeLessThan(before - 0.1);
		else await expect.poll(now).toBeGreaterThan(before + 0.1);
	};

	test("every volume fader drawn is enabled, and moving it turns this device's volume and sends the player none", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);
		const bar = statusBar(page);

		if (isMobile) await showVolume(bar).click();
		await expectTurnsThisDevice(page, isMobile, faderIn(bar), 0.9, 0.2);

		if (isMobile) {
			await page.keyboard.press("Escape");
			await openNowPlaying(page);
			const screen = nowPlayingScreen(page);
			await showVolume(screen).click();
			await expectTurnsThisDevice(page, isMobile, faderIn(screen), 0.2, 0.9);
		}

		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});

	test("the player's own fader under Listen here stays disabled with the reason, and moving it sends no volume", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);
		await choosePlayer(page).click();
		const fader = playingOn(page).getByRole("slider", {
			name: /^Volume on foobar2000\b/,
		});

		await expectDisabledWithReason(fader);

		await fader.click({ force: true });
		if (!isMobile) await dragTo(page, fader, 0.6);
		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});

	test("the volume keys turn and mute this device, and send nothing the player would refuse", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");

		const since = await listeningHere(page, player);
		const volume = async () => (await deviceAudio(page)).volume;
		const isMuted = async () => (await deviceAudio(page)).isMuted;

		const full = await volume();
		await pressFromTheBody(page, ["-"]);
		await expect.poll(volume).toBeLessThan(full);
		const lowered = await volume();
		await pressFromTheBody(page, ["="]);
		await expect.poll(volume).toBeGreaterThan(lowered);

		await pressFromTheBody(page, ["m"]);
		await expect.poll(isMuted).toBe(true);
		await pressFromTheBody(page, ["m"]);
		await expect.poll(isMuted).toBe(false);

		await expectSettlesAt(player, () => refusedAsks(player, since), []);
	});

	for (const isListening of [true, false])
		test(`the transport keys, s and o send nothing, and o opens no list, ${isListening ? "listening here" : "with nothing listening"}`, async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(isMobile, "no keyboard on the phone");

			const since = isListening
				? await listeningHere(page, player)
				: await playingAtThePlayer(page, player).then(() => 0);

			await pressFromTheBody(page, [
				"Space",
				"ControlOrMeta+ArrowRight",
				"ControlOrMeta+ArrowLeft",
				"ControlOrMeta+.",
				"ArrowRight",
				"ArrowLeft",
			]);
			await trackRow(page, 4).click();
			await page.keyboard.press("s");
			await expect(orderButton(page, false)).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			// Last, with nothing pressed after it: a click on a row would dismiss a list it had
			// opened.
			await pressFromTheBody(page, ["o"]);

			await expectSettlesAt(player, () => refusedAsks(player, since), []);
			await expectNothingOpened(page);
		});

	test("the status bar, and a phone's now-playing screen, still say why once", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);

		const line = statusBar(page).getByText(REASON);
		await expect(line).toHaveCount(1);
		await expect(line).toBeVisible();

		if (isMobile) {
			await openNowPlaying(page);
			const onScreen = nowPlayingScreen(page).getByText(REASON);
			await expect(onScreen).toHaveCount(1);
			await expect(onScreen).toBeVisible();
		}
	});
});

test.describe("the phone's volume faders with playback control off at the player and nothing listening", () => {
	test.use({ fooJean: { canControlPlayback: false } });
	test.skip(
		({ isMobile }) => !isMobile,
		"the popover faders are compact-only; the wide status bar's is read-only-playback.spec.ts's",
	);

	test("the status bar's and the now-playing screen's faders are disabled with the reason, and moving them sends no volume", async ({
		page,
		player,
	}) => {
		await playingAtThePlayer(page, player);
		const bar = statusBar(page);
		await bar.getByRole("button", { name: "Show volume" }).click();
		const barFader = bar.getByRole("slider", { name: /^Volume\b/ });
		await expectDisabledWithReason(barFader);
		await barFader.click({ force: true });

		await page.keyboard.press("Escape");
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);
		await screen.getByRole("button", { name: "Show volume" }).click();
		const screenFader = screen.getByRole("slider", { name: /^Volume\b/ });
		await expectDisabledWithReason(screenFader);
		await screenFader.click({ force: true });

		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});
});

test.describe("playback control turned off while Jean is open", () => {
	// Jean learns of the switch on the poll, and a drag already under way was
	// armed before it did. Whatever the gesture does after the controls redraw
	// disabled is a write Jean already knew would be refused.
	test("a volume drag under way stops writing once the fader turns disabled", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a fader is a mouse gesture");

		await playingAtThePlayer(page, player);
		const fader = statusBarVolume(page);
		await expect(fader).not.toHaveAttribute("aria-disabled", "true");
		const poll = await holdThePoll(page);

		const box = (await fader.boundingBox())!;
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + box.width * 0.2, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 });
		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(0);
		await untilQuiet(player);

		await allowPlayback(page, false);
		poll.letOneThrough();
		await expect(fader).toHaveAttribute("aria-disabled", "true");
		await untilQuiet(player);
		const sentBeforeJeanKnew = countPostsTo(player, "/api/volume");

		await page.mouse.move(box.x + box.width * 0.9, y, { steps: 10 });
		await page.mouse.up();

		await expectSettlesAt(
			player,
			() => countPostsTo(player, "/api/volume"),
			sentBeforeJeanKnew,
		);
	});

	// The poll is held, so the player's own 403 is the only way Jean can learn
	// the switch moved. A drag coalesces its writes, and a refusal swallowed
	// there leaves the fader live and says nothing.
	test("a volume drag refused by playback control says so in a toast, and the fader turns disabled with its reason before the next poll", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a fader is a mouse gesture");

		await playingAtThePlayer(page, player);
		const fader = statusBarVolume(page);
		await expect(fader).not.toHaveAttribute("aria-disabled", "true");

		await holdThePoll(page);
		await allowPlayback(page, false);

		const refused = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				new URL(response.url()).pathname === "/api/volume" &&
				response.status() === 403,
		);
		await dragTo(page, fader, 0.3);
		await refused;

		await expect(playbackOffToast(page)).toContainText(REASON);
		await expect(fader).toHaveAttribute("aria-disabled", "true");
		await expect(fader).toHaveAccessibleName(REASON);
	});

	// The poll is held, so the player's own 403 is the only way Jean can learn the switch moved.
	test("an order chosen is refused in a toast, the button goes back to the order the player is in, and it turns disabled with its reason before the next poll", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await globalControls(page, isMobile);
		const order = orderButton(page, isMobile);
		await expect(order).toHaveAccessibleName("Playback order: In order");
		const held = player.player.playbackMode;

		await holdThePoll(page);
		await allowPlayback(page, false);

		const refused = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				new URL(response.url()).pathname === "/api/playback/mode" &&
				response.status() === 403,
		);
		await order.click();
		await page
			.getByRole("menuitemradio", { name: "Repeat track", exact: true })
			.click();
		await refused;

		await expect(playbackOffToast(page)).toContainText(REASON);
		await expect(order).toHaveAttribute("aria-disabled", "true");
		await expect(order).toHaveAccessibleName(
			"Playback order: In order (playback control is off)",
		);
		expect(player.player.playbackMode).toBe(held);
	});

	// Emptying the scratch is playback, so it follows controlPlayback. Clearing
	// the search is still the user's to do; only the write behind it goes.
	test("clearing the search with a played set in the scratch sends nothing refused and raises no toast", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "babasonicos");
		await trackRow(page, 0).dblclick();
		await expect.poll(() => scratchOf(player)?.items.length).toBe(12);
		await expect(statusBar(page)).toContainText("Los Calientes");
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

		await allowPlayback(page, false);
		await expect(playPause(page)).toHaveAttribute("aria-disabled", "true");
		await untilQuiet(player);
		const since = player.requests.length;

		await page.getByRole("button", { name: "Clear search" }).click();
		await revealSearch(page);
		await expect(searchField(page)).toHaveValue("");

		await expectSettlesAt(player, () => refusedAsks(player, since), []);
		await expect(playbackOffToast(page)).toHaveCount(0);
	});
});
