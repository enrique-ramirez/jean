import type { FakePlayer, Page } from "./fixtures.ts";
import {
	componentOrigin,
	dragTo,
	expect,
	expectSettlesAt,
	inSequence,
	openLibrary,
	openSettings,
	playedFrom,
	playRequests,
	pressAndHold,
	settingsDialog,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// The Library fixture is Jessico in playlist order.
const THIRD_TRACK = { title: "Deléctrico", artist: "Babasónicos", index: 2 };

const libraryGuid = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title === "Library")!.guid;

// Album mode renders its rows through AlbumGroup rather than TrackList, so
// these gestures take a different path in each layout.
["compact", "album"].forEach((layout) => {
	test.describe(`playing a track (${layout} layout)`, () => {
		test.use({ settings: { "jean.layout": layout } });

		test.beforeEach(async ({ page }) => {
			await openLibrary(page);
			await expect(
				page.getByRole("heading", { level: 1, name: "Library" }),
			).toBeVisible();
			await expect(statusBar(page)).toContainText("Nothing playing");
		});

		test("double-clicking a row plays that track", async ({ page, player }) => {
			test.skip(
				test.info().project.name === "mobile",
				"double-click is a pointer gesture",
			);

			const row = trackRow(page, THIRD_TRACK.index);
			await expect(row).toContainText(THIRD_TRACK.title);

			await row.dblclick();

			// Index is identity in this API, so an off-by-one plays the wrong song
			// and still looks right on screen.
			await expect
				.poll(() => playedFrom(player))
				.toEqual({ id: libraryGuid(player), index: THIRD_TRACK.index });

			// Nothing below is written by the click: the app learns it played from
			// the state the next poll reads afterwards.
			await expect(statusBar(page)).toContainText(THIRD_TRACK.title);
			await expect(statusBar(page)).toContainText(THIRD_TRACK.artist);
			await expect(
				statusBar(page).getByRole("button", { name: "Pause" }),
			).toBeVisible();
			await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
				"data-active",
				"true",
			);
			// The equalizer replaces the track number in the active row and is the
			// only thing on the page labelled this way.
			await expect(page.getByLabel("Now playing")).toHaveCount(1);
			await expect(
				trackRow(page, THIRD_TRACK.index).getByLabel("Now playing"),
			).toBeVisible();
		});

		test("Enter plays the track the cursor is on", async ({ page, player }) => {
			test.skip(
				test.info().project.name === "mobile",
				"no keyboard on the phone",
			);

			await expect(trackRow(page, 0)).toHaveAttribute("data-cursor", "true");
			await page.keyboard.press("ArrowDown");
			await expect(trackRow(page, 1)).toHaveAttribute("data-cursor", "true");

			await page.keyboard.press("Enter");

			await expect
				.poll(() => playedFrom(player))
				.toEqual({ id: libraryGuid(player), index: 1 });
			await expect(statusBar(page)).toContainText("Fizz");
		});

		test("the header Play button starts the playlist from the top", async ({
			page,
			player,
		}) => {
			await page
				.getByRole("main")
				.getByRole("button", { name: "Play", exact: true })
				.click();

			await expect
				.poll(() => playedFrom(player))
				.toEqual({ id: libraryGuid(player), index: 0 });
			await expect(statusBar(page)).toContainText("Los Calientes");
		});

		test("on a pointer, a single click selects and does not play", async ({
			page,
			player,
		}) => {
			// Tap-to-play is decided by pointerType, so a regression there turns
			// every desktop click into playback rather than breaking the phone.
			test.skip(
				test.info().project.name === "mobile",
				"this is the mouse path",
			);

			await trackRow(page, THIRD_TRACK.index).click();

			await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expectSettlesAt(player, () => playRequests(player), []);
			await expect(statusBar(page)).toContainText("Nothing playing");
		});

		test("pausing from the status bar leaves the track where it is", async ({
			page,
			player,
		}) => {
			await page
				.getByRole("main")
				.getByRole("button", { name: "Play", exact: true })
				.click();
			await expect(
				statusBar(page).getByRole("button", { name: "Pause" }),
			).toBeVisible();

			await statusBar(page).getByRole("button", { name: "Pause" }).click();

			await expect(
				statusBar(page).getByRole("button", { name: "Play", exact: true }),
			).toBeVisible();
			await expect(statusBar(page)).toContainText("Los Calientes");
			await expect.poll(() => player.player.playbackState).toBe("paused");
		});
	});

	test.describe(`playing on touch (${layout} layout)`, () => {
		test.skip(({ isMobile }) => !isMobile, "these are touch gestures");
		test.use({ settings: { "jean.layout": layout } });

		test.beforeEach(async ({ page }) => {
			await openLibrary(page);
			await expect(
				page.getByRole("heading", { level: 1, name: "Library" }),
			).toBeVisible();
		});

		test("a tap plays the track", { tag: "@iphone" }, async ({
			page,
			player,
		}) => {
			await trackRow(page, THIRD_TRACK.index).tap();

			await expect
				.poll(() => playedFrom(player))
				.toEqual({ id: libraryGuid(player), index: THIRD_TRACK.index });
			await expect(statusBar(page)).toContainText(THIRD_TRACK.title);
			await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
				"data-active",
				"true",
			);
		});

		test("a press-and-hold opens the menu and plays nothing", {
			tag: "@iphone",
		}, async ({ page, player }) => {
			await pressAndHold(page, trackRow(page, THIRD_TRACK.index));

			await expect(page.getByRole("dialog")).toBeVisible();
			await expectSettlesAt(player, () => playRequests(player), []);
		});
	});
});

// The poll is dropped as well, or its next answer would put the control back
// whether or not the failed command did, and the case would pass either way.
test.describe("a component that hangs up on every command", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the fader and the seek bar are mouse gestures, and the status bar is where the controls sit side by side",
	);

	const hangUpOnCommands = async (
		page: Page,
		player: FakePlayer,
		drawsThePress: () => Promise<unknown>,
	) => {
		player.fooJean.dropState = true;
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
	test.use({ fooJean: { reachable: false } });
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("every command key does nothing, and nothing throws", async ({
		page,
		player,
	}) => {
		const thrown: string[] = [];
		page.on("pageerror", (error) => thrown.push(error.message));
		const before = structuredClone(player.player);

		await openSettings(page);
		await expect(settingsDialog(page)).toContainText(
			"foo_jean is not answering right now.",
		);
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
