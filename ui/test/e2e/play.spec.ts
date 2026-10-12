import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	componentOrigin,
	drawing,
	expect,
	expectSettlesAt,
	inSequence,
	openLibrary,
	openSettings,
	orderButton,
	pickerOpener,
	playedFrom,
	playerDeclaring,
	playingOn,
	playRequests,
	settingsDialog,
	statusBar,
	test,
	toasts,
	trackRow,
} from "./fixtures.ts";
import { dragTo, pressAndHold, touchDrag } from "./gestures.ts";
import { scrollTop } from "./scrolling.ts";

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
			await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
				"data-cursor",
				"true",
			);
		});

		// With Playback follows cursor on, the cursor is what plays next, so a finger that landed on a
		// row only to scroll past it would reorder the listening.
		test("a scroll that starts on a row leaves the cursor and the selection alone", async ({
			page,
			player,
		}) => {
			const row = trackRow(page, THIRD_TRACK.index);
			const box = (await row.boundingBox())!;
			const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

			await touchDrag(page, from, { x: from.x, y: from.y - 240 }, 8);

			await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
			await expect(row).toHaveAttribute("data-cursor", "false");
			await expect(
				page.locator('[role="row"][data-selected="true"]'),
			).toHaveCount(0);
			await expectSettlesAt(player, () => playRequests(player), []);
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

// A popover in the status bar has no scrim, so the tap that closes it lands on
// whatever is underneath, and a track row there plays on a tap.
test.describe("a tap outside a status bar popover", () => {
	test.skip(({ isMobile }) => !isMobile, "these are touch gestures");

	const popovers = [
		{
			name: "Playing on",
			open: (page: Page) => pickerOpener(page).tap(),
			panel: (page: Page) => playingOn(page),
		},
		{
			name: "volume",
			open: (page: Page) =>
				statusBar(page).getByRole("button", { name: "Show volume" }).tap(),
			panel: (page: Page) =>
				statusBar(page).getByRole("slider", { name: /Volume/ }),
		},
	];

	popovers.forEach(({ name, open, panel }) => {
		test(`closes the ${name} popover and plays nothing`, async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			const row = trackRow(page, THIRD_TRACK.index);
			await expect(row).toBeVisible();

			const box = (await row.boundingBox())!;
			await open(page);
			await expect(panel(page)).toBeVisible();

			// At the row's own point rather than on the row: on a phone the Playing on picker is a
			// sheet whose scrim lies over the row, and that scrim is what this tap lands on.
			await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
			await expect(panel(page)).toBeHidden();
			await expect(row).toHaveAttribute("data-cursor", "false");
			await expectSettlesAt(player, () => playRequests(player), []);
		});
	});

	// The browser counts the tap that closed the popover toward the next one's
	// click count, so the second reads as the back half of a double tap, which a
	// row answers by not playing again.
	test("a tap straight after the one that closed it plays", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const row = trackRow(page, THIRD_TRACK.index);
		await expect(row).toBeVisible();
		const box = (await row.boundingBox())!;
		const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await popovers[0].open(page);
		await expect(popovers[0].panel(page)).toBeVisible();

		await touchDrag(page, centre, centre, 0);
		await touchDrag(page, centre, centre, 0);

		await expectSettlesAt(player, () => playRequests(player).length, 1);
		expect(playedFrom(player)).toEqual({
			id: libraryGuid(player),
			index: THIRD_TRACK.index,
		});
	});

	// A row plays a click only where its last press was a touch, so the tap that played a track
	// first is what lets Chromium's second hit test, made once the scrim stops taking pointers,
	// hand the scrim's tap to the row under it.
	test("after a track played by a tap, a tap on the Playing on sheet's scrim over another row closes it, plays nothing more and moves no cursor", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const first = trackRow(page, 0);
		await touchDrag(page, await centreOf(first), await centreOf(first), 0);
		await expect(first).toHaveAttribute("data-cursor", "true");
		await expectSettlesAt(player, () => playRequests(player).length, 1);

		const under = trackRow(page, THIRD_TRACK.index);
		const point = await centreOf(under);
		await popovers[0].open(page);
		const sheet = page.getByRole("dialog", { name: "Playing on" });
		await expect(sheet).toBeVisible();

		await touchDrag(page, point, point, 0);

		await expect(sheet).toHaveCount(0);
		await expectSettlesAt(player, () => playRequests(player).length, 1);
		await expect(under).toHaveAttribute("data-cursor", "false");
	});
});

const centreOf = async (target: Locator) => {
	const box = (await target.boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

// A touch double tap is two clicks, the second with `detail` 2, and a row answers it by playing
// once, as a mouse's double click does.
test.describe("tapping rows in quick succession", () => {
	test.skip(({ isMobile }) => !isMobile, "these are touch gestures");

	test("a double tap on a row plays it once", async ({ page, player }) => {
		await openLibrary(page);
		const row = trackRow(page, THIRD_TRACK.index);
		await expect(row).toBeVisible();
		const centre = await centreOf(row);

		await touchDrag(page, centre, centre, 0);
		await touchDrag(page, centre, centre, 0);

		await expectSettlesAt(player, () => playRequests(player).length, 1);
		expect(playedFrom(player)).toEqual({
			id: libraryGuid(player),
			index: THIRD_TRACK.index,
		});
	});

	// Chromium counts a second tap toward a double tap only near the first, so a tap on the next row
	// down is a click of its own.
	test("two quick taps on two neighbouring rows play each", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const first = await centreOf(trackRow(page, THIRD_TRACK.index));
		const next = await centreOf(trackRow(page, THIRD_TRACK.index + 1));

		await touchDrag(page, first, first, 0);
		await touchDrag(page, next, next, 0);

		await expectSettlesAt(
			player,
			() =>
				playRequests(player).map((entry) =>
					Number(/items\/(\d+)\/play/.exec(entry.path)?.[1]),
				),
			[THIRD_TRACK.index, THIRD_TRACK.index + 1],
		);
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
		await expect(orderButton(page, false)).toBeVisible();
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

	test("an order chosen from the list goes back to In order, on the button's name, its face and the list's tick, and no toast is raised", async ({
		page,
		player,
	}) => {
		const order = orderButton(page, false);
		const checked = page.getByRole("menuitemradio", { checked: true });
		await expect(order).toHaveAccessibleName("Playback order: In order");
		const hungUp = await hangUpOnCommands(page, player, () =>
			expect(order).toHaveAccessibleName("Playback order: Repeat track", DRAWN),
		);

		await order.click();
		await page
			.getByRole("menuitemradio", { name: "Repeat track", exact: true })
			.click();

		await expect.poll(() => hungUp).toContain("/api/playback/mode");
		await expect(order).toHaveAccessibleName("Playback order: In order");
		await expect(order.locator("svg")).toHaveClass(
			drawing("layout-arrow-down"),
		);
		expect(player.player.playbackMode).toBe(0);
		// Read once: `toHaveCount(0)` retries, and a toast that leaves by itself would let it pass.
		expect(await toasts(page).count()).toBe(0);

		await order.click();
		await expect(checked).toHaveAccessibleName("In order");
	});

	test.describe("on an install offering two orders", () => {
		test.use({
			playerState: playerDeclaring(["Default", "Repeat (playlist)"]),
		});

		test("the order a press flipped to goes back to In order, on the button's name and its face", async ({
			page,
			player,
		}) => {
			const order = orderButton(page, false);
			await expect(order).toHaveAccessibleName("Playback order: In order");
			const hungUp = await hangUpOnCommands(page, player, () =>
				expect(order).toHaveAccessibleName(
					"Playback order: Repeat playlist",
					DRAWN,
				),
			);

			await order.click();

			await expect.poll(() => hungUp).toContain("/api/playback/mode");
			await expect(order).toHaveAccessibleName("Playback order: In order");
			await expect(order.locator("svg")).toHaveClass(
				drawing("layout-arrow-down"),
			);
			expect(player.player.playbackMode).toBe(0);
		});
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
