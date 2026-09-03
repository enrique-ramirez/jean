import {
	expect,
	playedFrom,
	pressAndHold,
	requestsTo,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// The Library fixture is Jessico in playlist order.
const THIRD_TRACK = { title: "Deléctrico", artist: "Babasónicos", index: 2 };

// Album mode renders its rows through AlbumGroup rather than TrackList, so
// these gestures take a different path in each layout.
["compact", "album"].forEach((layout) => {
	test.describe(`playing a track (${layout} layout)`, () => {
		test.use({ settings: { "jean.layout": layout } });

		test.beforeEach(async ({ page }) => {
			await page.goto("/#/p7");
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
				.toEqual({ plref: "p7", index: THIRD_TRACK.index });

			// Nothing below is written by the click: the app learns it played from
			// the SSE snapshot the fake pushes afterwards.
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

			// Arrow keys move a cursor held in state rather than DOM focus: the
			// virtualiser unmounts the focused row the moment it scrolls away. The
			// cursor starts on the first row, so one press is row 1.
			await expect(trackRow(page, 0)).toHaveAttribute("data-cursor", "true");
			await page.keyboard.press("ArrowDown");
			await expect(trackRow(page, 1)).toHaveAttribute("data-cursor", "true");

			await page.keyboard.press("Enter");

			await expect
				.poll(() => playedFrom(player))
				.toEqual({ plref: "p7", index: 1 });
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
				.toEqual({ plref: "p7", index: 0 });
			await expect(statusBar(page)).toContainText("Los Calientes");
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
				statusBar(page).getByRole("button", { name: "Play" }),
			).toBeVisible();
			await expect(statusBar(page)).toContainText("Los Calientes");
			await expect.poll(() => player.player.playbackState).toBe("paused");
		});
	});

	test.describe(`playing on touch (${layout} layout)`, () => {
		test.skip(({ isMobile }) => !isMobile, "these are touch gestures");
		test.use({ settings: { "jean.layout": layout } });

		test.beforeEach(async ({ page }) => {
			await page.goto("/#/p7");
			await expect(
				page.getByRole("heading", { level: 1, name: "Library" }),
			).toBeVisible();
		});

		test("a tap plays the track", async ({ page, player }) => {
			await trackRow(page, THIRD_TRACK.index).tap();

			await expect
				.poll(() => playedFrom(player))
				.toEqual({ plref: "p7", index: THIRD_TRACK.index });
			await expect(statusBar(page)).toContainText(THIRD_TRACK.title);
			await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
				"data-active",
				"true",
			);
		});

		test("a press-and-hold opens the menu and plays nothing", async ({
			page,
			player,
		}) => {
			// A hold ends in a synthetic click, which useLongPress swallows in its
			// capture phase.
			await pressAndHold(page, trackRow(page, THIRD_TRACK.index));

			await expect(page.getByRole("dialog")).toBeVisible();
			await page.waitForTimeout(150);
			expect(requestsTo(player, "/player/play/")).toEqual([]);
		});
	});

	test(`on a pointer, a single click selects and does not play (${layout} layout)`, async ({
		page,
		player,
	}) => {
		// Tap-to-play is decided by pointerType, so a regression there turns every
		// desktop click into playback rather than breaking the phone.
		test.skip(test.info().project.name === "mobile", "this is the mouse path");

		await page.goto("/#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		await trackRow(page, THIRD_TRACK.index).click();

		await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute(
			"data-selected",
			"true",
		);
		await page.waitForTimeout(150);
		expect(requestsTo(player, "/player/play/")).toEqual([]);
		await expect(statusBar(page)).toContainText("Nothing playing");
	});
});
