import {
	countPostsTo,
	deviceAudio,
	expect,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	type FakePlayer,
	type Locator,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	type Page,
	pickerOpener,
	playingOn,
	playRequests,
	requestsTo,
	statusBar,
	test,
	toasts,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import {
	dragTo,
	fromTheGrabber,
	restingBox,
	touchDrag,
	watchHowFarItMoves,
} from "./gestures.ts";
import {
	currentTime,
	HAND_BACK,
	HEARD,
	listensInItsOwn,
	mutesInThePanel,
	pickerPanel,
	playerFader,
	playerRow,
	SPEAKERS,
	startListening,
	stopButtons,
	TICK,
	thePlayer,
	ticketRequests,
} from "./listening.ts";
import {
	currentRows,
	OFFERING_SESSIONS,
	startButton,
	thePlayersFace,
} from "./sessions.ts";

test.describe("where the picker sits", () => {
	test.use({ fooJean: {} });

	// The button is a third of the way in from the right edge at every width, so a
	// panel whose right edge is the button's hangs off the left of a phone.
	test("it is on the screen, both ends, wherever it was opened from", async ({
		page,
		isMobile,
	}) => {
		await page.goto("/");

		const width = page.viewportSize()?.width ?? 0;
		const check = async (where: string) => {
			const box = (await playingOn(page).boundingBox())!;
			expect(box.x, `${where}: ran off the left`).toBeGreaterThanOrEqual(0);
			expect(
				box.x + box.width,
				`${where}: ran off the right`,
			).toBeLessThanOrEqual(width);
		};

		await pickerOpener(page).click();
		await check("the status bar");

		if (!isMobile) return;

		// The screen replaces the status bar on a phone, so the same panel opens
		// from the transport instead -- a different anchor and the same answer.
		await page.keyboard.press("Escape");
		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", {
				name: /Choose where to play|Playing on this device/,
			})
			.click();
		await check("the now-playing transport");
	});
});

test.describe("the picker on the now-playing screen", () => {
	test.use({ fooJean: {} });

	// The phone's screen replaces the status bar, so without a copy here the one
	// control that says where the sound is going is unreachable while it is open.
	test.skip(
		({ isMobile }) => !isMobile,
		"the desktop screen draws no transport: the status bar under it carries both",
	);

	test("is beside the fader, and opens onto the same picker", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await expect(statusBar(page)).toHaveCount(0);

		const screen = nowPlayingScreen(page);
		await screen
			.getByRole("button", { name: /Choose where to play|Playing on this/ })
			.click();

		await expect(playingOn(page)).toBeVisible();
		await expect(thePlayer(page)).toBeVisible();
		await expect(thePlayersFace(page)).toBeVisible();
	});

	test("hands the sound to this device from there", async ({ page }) => {
		await page.goto("/");
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Choose where to play|Playing on this/ })
			.click();
		await thePlayersFace(page).click();

		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
	});
});

const HEARD_ARTIST = "Babasónicos";

test.describe("the Playing on panel", () => {
	test.use({ fooJean: {} });

	test("offers no mute while the player is the one playing, nor once this device listens", async ({
		page,
	}) => {
		await page.goto("/");
		await pickerOpener(page).click();
		expect(await mutesInThePanel(page)).toBe(0);

		// Listening here silences the player, and the Stop that hands the sound back is the panel
		// saying so. A player held silent is where a mute would be drawn if anywhere.
		await thePlayersFace(page).click();
		await expect(
			playingOn(page).getByRole("button", { name: HAND_BACK, exact: true }),
		).toBeVisible();
		expect(await mutesInThePanel(page)).toBe(0);
	});
});

test.describe("the player's row", () => {
	test.use({ fooJean: {} });

	test("on the player and not listening, its face is the one Listen here in the picker", async ({
		page,
	}) => {
		await page.goto("/");
		await pickerOpener(page).click();

		await expect(thePlayersFace(page)).toBeVisible();
		// The face holds the player's name: a Listen here beside the name is the separate row again.
		await expect(thePlayersFace(page)).toContainText("foobar2000");
		await expect(
			playerRow(page).getByRole("button", { name: "Listen here" }),
		).toHaveCount(1);
		await expect(
			playingOn(page).getByRole("button", { name: /listen here/i }),
		).toHaveCount(1);
		await expect(
			pickerPanel(page).getByText("Listen here", { exact: true }),
		).toHaveCount(1);
	});

	test("is the only row with a slider, and is marked current whether or not this device listens", async ({
		page,
	}) => {
		await page.goto("/");
		await pickerOpener(page).click();

		await expect(thePlayersFace(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText("foobar2000");
		await expect(playingOn(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRow(page).getByRole("slider")).toHaveCount(1);

		await thePlayersFace(page).click();
		await expect(stopButtons(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText("foobar2000");
		await expect(playingOn(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRow(page).getByRole("slider")).toHaveCount(1);
	});

	// A control inside the face is a press that also listens.
	test("holds nothing interactive inside its face", async ({ page }) => {
		await page.goto("/");
		await pickerOpener(page).click();

		const face = thePlayersFace(page);
		await expect(face).toBeVisible();
		await expect(playerRow(page).getByRole("slider")).toBeVisible();
		await expect(face.getByRole("button")).toHaveCount(0);
		await expect(face.getByRole("slider")).toHaveCount(0);
		await expect(face.getByRole("link")).toHaveCount(0);
	});

	test("its fader moves the player and not this device while this device listens", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);
		await untilQuiet(player);
		const before = await deviceAudio(page);
		const volumes = countPostsTo(player, "/api/volume");

		const fader = playerRow(page).getByRole("slider", {
			name: "Volume on foobar2000",
		});
		await expect(fader).toBeVisible();
		if (isMobile) {
			const box = (await fader.boundingBox())!;
			await fader.tap({ position: { x: box.width * 0.6, y: box.height / 2 } });
		} else await dragTo(page, fader, 0.6);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
		expect(await deviceAudio(page)).toEqual(before);
	});
});

test.describe("the picker on the desktop", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const openFromTheKeyboard = async (page: Page) => {
		await pickerOpener(page).focus();
		await page.keyboard.press("Enter");
		await expect(playingOn(page)).toBeVisible();
	};

	const listeningWithThePickerShut = async (page: Page) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
	};

	test("Enter on the opener opens the picker on the player's face", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);

		await expect(thePlayersFace(page)).toBeFocused();
	});

	test("listening, Enter on the opener opens the picker on Stop", async ({
		page,
	}) => {
		await listeningWithThePickerShut(page);
		await openFromTheKeyboard(page);

		await expect(stopButtons(page)).toBeFocused();
	});

	test("not listening, Tab walks from the face to the player's fader and back", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		const fader = playerRow(page).getByRole("slider");

		await expect(thePlayersFace(page)).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(fader).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(thePlayersFace(page)).toBeFocused();
	});

	test("listening, Tab walks the fader, the cog and then Stop", async ({
		page,
	}) => {
		await listeningWithThePickerShut(page);
		await openFromTheKeyboard(page);
		const fader = playerRow(page).getByRole("slider");
		const cog = playerRow(page).getByRole("button", {
			name: "Output options",
			exact: true,
		});

		await expect(stopButtons(page)).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(cog).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(fader).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(cog).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(stopButtons(page)).toBeFocused();
	});

	test("Escape closes the picker and gives focus back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(pickerOpener(page)).toBeFocused();
	});

	// With the player's row the only row there is no row to move to, and the fader is reached by
	// Tab alone.
	test("with one row, the arrows leave focus on the player's face and move no fader", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(thePlayersFace(page)).toBeFocused();

		for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) {
			await page.keyboard.press(key);
			await expect(thePlayersFace(page), key).toBeFocused();
		}
		await untilQuiet(player);
		expect(countPostsTo(player, "/api/volume")).toBe(0);
	});

	// Polled, so a control that takes focus a frame after the swap is not read as having lost it.
	const whereFocusSettles = (page: Page) =>
		expect.poll(() =>
			pickerPanel(page).evaluate((panel) => {
				const focused = document.activeElement;
				if (!focused || focused === document.body) return "body";
				return panel.contains(focused) ? "the picker" : "elsewhere";
			}),
		);

	// A press that swaps the control it was made on would otherwise drop focus to `body`, from where
	// Escape no longer knows to give it back to the opener.
	test("Enter on the player's face listens and leaves focus on Stop, from where Escape gives it back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(stopButtons(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(stopButtons(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(pickerOpener(page)).toBeFocused();
	});

	test("open, listen, stop and close by Enter and Escape alone, with focus inside the picker at every step", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await whereFocusSettles(page).toBe("the picker");
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(stopButtons(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(stopButtons(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(thePlayersFace(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(pickerOpener(page)).toBeFocused();
	});

	test("the popover is 360 pixels wide", async ({ page }) => {
		await page.goto("/");
		await pickerOpener(page).click();

		const box = (await pickerPanel(page).boundingBox())!;
		expect(Math.round(box.width)).toBe(360);
	});
});

const pickerSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Playing on" });

const closeButton = (page: Page) =>
	pickerSheet(page).getByRole("button", { name: "Close", exact: true });

const openerOnTheScreen = (page: Page) =>
	nowPlayingScreen(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

const openTheSheet = async (page: Page) => {
	await pickerOpener(page).click();
	await expect(pickerSheet(page)).toBeVisible();
	return pickerSheet(page);
};

// Longer than a sheet on its way out stays drawn, so one still there after it was never closed.
const PAST_ITS_EXIT_MS = 600;

const expectTheSheetStillOpen = async (page: Page) => {
	await page.waitForTimeout(PAST_ITS_EXIT_MS);
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(pickerSheet(page)).toBeVisible();
};

// Either side of the distance the grabber has to travel before letting go closes the sheet, each
// far enough from it that the gesture is unambiguous.
const SHORT_OF_CLOSING_PX = 50;
const PAST_CLOSING_PX = 140;

// A box is fractional, so a sheet back at rest can sit a fraction of a pixel off.
const AT_REST_PX = 1;

// Enough moves that the browser paints the sheet between them.
const DRAG_STEPS = 12;

// The smallest target a fingertip lands on reliably, and the taller one the design gives a face.
const FINGER_PX = 44;
const FACE_PX = 52;
const PILL_WIDTH_PX = 64;

const SHEET_HEIGHT_LIMIT = 0.76;

const expectAtLeast = async (
	target: Locator,
	what: string,
	size: { width?: number; height?: number },
) => {
	await expect(target).toBeVisible();
	const box = (await restingBox(target))!;
	if (size.height !== undefined)
		expect(box.height, `${what}: height`).toBeGreaterThanOrEqual(size.height);
	if (size.width !== undefined)
		expect(box.width, `${what}: width`).toBeGreaterThanOrEqual(size.width);
};

const expectOnTheScreen = (
	page: Page,
	box: { x: number; y: number; width: number; height: number },
	where: string,
) => {
	const viewport = page.viewportSize()!;
	expect(box.x, `${where}: ran off the left`).toBeGreaterThanOrEqual(0);
	expect(box.y, `${where}: ran off the top`).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width, `${where}: ran off the right`).toBeLessThanOrEqual(
		viewport.width,
	);
	expect(
		box.y + box.height,
		`${where}: ran off the bottom`,
	).toBeLessThanOrEqual(viewport.height);
};

test.describe("the picker on a phone is a bottom sheet", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("the opener in the status bar opens a modal dialog named Playing on, holding the player's row and its face", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await expect(page.getByRole("dialog")).toHaveCount(1);
		await expect(sheet).toHaveAttribute("aria-modal", "true");
		await expect(
			sheet.getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(
			sheet
				.getByRole("listitem")
				.filter({ has: page.getByText("foobar2000", { exact: true }) }),
		).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Listen here", exact: true }),
		).toBeVisible();
	});

	test("the opener on the now-playing screen opens the same dialog, holding the same row and face", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();

		const sheet = pickerSheet(page);
		await expect(sheet).toBeVisible();
		await expect(sheet).toHaveAttribute("aria-modal", "true");
		await expect(
			sheet.getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Listen here", exact: true }),
		).toBeVisible();
	});

	test("it is wholly on the screen, from either opener", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);
		expectOnTheScreen(
			page,
			await restingBox(pickerSheet(page)),
			"from the status bar",
		);

		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();
		await expect(pickerSheet(page)).toBeVisible();
		expectOnTheScreen(
			page,
			await restingBox(pickerSheet(page)),
			"from the now-playing screen",
		);
	});

	test("its Close button closes it", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await closeButton(page).click();

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a press on the scrim above it closes it", async ({ page }) => {
		await page.goto("/");
		const box = await restingBox(await openTheSheet(page));

		await page.touchscreen.tap(box.x + box.width / 2, box.y / 2);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("Escape closes it", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await page.keyboard.press("Escape");

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	// The now-playing screen closes on Escape too, and the sheet opened from it is in front of it.
	// A phone's keys are an attached keyboard's.
	test("opened from the now-playing screen, Escape closes the sheet and leaves the screen open, and Escape again closes the screen", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();
		await expect(pickerSheet(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);

		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();
	});

	// As behind a row's action sheet: the sheet is modal, so the transport's keys wait for it.
	test("while it is open, a transport key sends nothing to the player, and Escape still closes it", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openTheSheet(page);
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("ControlOrMeta+.");
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/playback/").filter(
					(entry) => entry.method === "POST",
				),
			[],
		);

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	// A press inside the sheet is not a press outside it: the face swaps for Stop under the finger,
	// and the swap must not read as the press having landed somewhere else.
	test("it stays open after Listen here, and after Stop", async ({ page }) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await sheet
			.getByRole("button", { name: "Listen here", exact: true })
			.click();
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
		await expectTheSheetStillOpen(page);
		await expect(stopButtons(page)).toBeVisible();

		await stopButtons(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expectTheSheetStillOpen(page);
		await expect(thePlayersFace(page)).toBeVisible();
	});

	test("opening it puts focus on the player's face, and Close gives it back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openTheSheet(page);

		await expect(thePlayersFace(page)).toBeFocused();

		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(pickerOpener(page)).toBeFocused();
	});

	test("listening, opening it puts focus on Stop", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);

		await openTheSheet(page);

		await expect(stopButtons(page)).toBeFocused();
	});

	// The sheet covers the status bar, which is where the track is named everywhere else.
	test("the player's row names the track it plays and its artist", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);

		await openTheSheet(page);

		await expect(playerRow(page)).toContainText(HEARD.title);
		await expect(playerRow(page)).toContainText(HEARD_ARTIST);
	});

	test("the player's row names no track while the player is stopped", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		player.stop();
		await expect(statusBar(page)).not.toContainText(HEARD.title);

		await openTheSheet(page);
		await expect(thePlayersFace(page)).toBeVisible();

		const row = await playerRow(page).innerText();
		expect(row).not.toContain(HEARD.title);
		expect(row).not.toContain(HEARD_ARTIST);
	});
});

test.describe("the picker's sheet goes by a drag down", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"a finger is driven through CDP",
	);

	test("the grabber dragged down past the distance closes it", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await fromTheGrabber(page, sheet, PAST_CLOSING_PX);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a downward drag that begins on its body, past the distance, closes it", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		const heading = await restingBox(sheet.getByRole("heading").first());

		const x = heading.x + heading.width / 2;
		const y = heading.y + heading.height / 2;
		await touchDrag(page, { x, y }, { x, y: y + PAST_CLOSING_PX }, DRAG_STEPS);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("the grabber dragged a shorter way carries it with the finger, and letting go leaves it open where it rested", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		const before = await restingBox(sheet);
		const furthest = await watchHowFarItMoves(sheet);

		await fromTheGrabber(page, sheet, SHORT_OF_CLOSING_PX);

		// Settled first, or the box read below is one the sheet passed on its way back.
		const after = await restingBox(sheet);
		expect(
			await furthest(),
			"how far the sheet followed the finger",
		).toBeGreaterThan(AT_REST_PX);
		expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(AT_REST_PX);
		await expectTheSheetStillOpen(page);
	});
});

// Enough listeners that the roster inside the player's row is taller than the sheet may stand.
const MANY_LISTENERS = Array.from({ length: 24 }, (_, index) => ({
	deviceId: `listener-${index + 1}`,
	name: `Listener ${index + 1}`,
	listeningFor: 60 * (index + 1),
}));

test.describe("the picker's sheet holding more than fits", () => {
	test.use({ fooJean: { otherListeners: MANY_LISTENERS } });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	const roster = (page: Page) =>
		pickerSheet(page).getByRole("list", { name: "Also listening" });
	const lastListener = (page: Page) =>
		roster(page).getByRole("listitem").filter({ hasText: "Listener 24" });

	const openItFull = async (page: Page) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		await expect(roster(page).getByRole("listitem")).toHaveCount(
			MANY_LISTENERS.length,
		);
		return sheet;
	};

	test("it stands no taller than 76% of the screen, and wholly on it", async ({
		page,
	}) => {
		const sheet = await openItFull(page);

		const box = await restingBox(sheet);
		const viewport = page.viewportSize()!;
		expect(box.height).toBeLessThanOrEqual(
			viewport.height * SHEET_HEIGHT_LIMIT + AT_REST_PX,
		);
		expectOnTheScreen(page, box, "the sheet");
	});

	test("scrolled to the end of its list, its heading and Close are still in view", async ({
		page,
	}) => {
		const sheet = await openItFull(page);
		const before = await restingBox(sheet);
		const last = await restingBox(lastListener(page));
		expect(
			last.y,
			"the last listener starts out below the sheet's edge",
		).toBeGreaterThan(before.y + before.height);

		await lastListener(page).scrollIntoViewIfNeeded();

		const box = await restingBox(sheet);
		const shown = await restingBox(lastListener(page));
		expect(
			shown.y + shown.height,
			"the last listener, shown",
		).toBeLessThanOrEqual(box.y + box.height + AT_REST_PX);
		for (const [what, target] of [
			["the heading", sheet.getByRole("heading", { name: "Playing on" })],
			["Close", closeButton(page)],
		] as const) {
			const at = await restingBox(target);
			expect(at.y, `${what}: scrolled above the sheet`).toBeGreaterThanOrEqual(
				box.y - AT_REST_PX,
			);
			expect(at.y + at.height, `${what}: below the sheet`).toBeLessThanOrEqual(
				box.y + box.height,
			);
		}
		await expect(closeButton(page)).toBeInViewport();
	});

	test("a downward drag begun on its body, with its list at the top, closes it", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);

		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await touchDrag(page, { x, y }, { x, y: y + PAST_CLOSING_PX }, 12);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a downward drag begun on its list scrolled away from the top scrolls it back and moves the sheet nowhere", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);
		const first = roster(page).getByRole("listitem").first();
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			12,
		);
		const scrolled = await restingBox(first);
		expect(scrolled.y, "the first listener, scrolled up").toBeLessThan(box.y);
		const furthest = await watchHowFarItMoves(sheet);

		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.5 },
			{ x, y: box.y + box.height * 0.5 + PAST_CLOSING_PX },
			12,
		);

		const after = await restingBox(first);
		expect(after.y, "the first listener, scrolled back").toBeGreaterThan(
			scrolled.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await expectTheSheetStillOpen(page);
	});

	test("a drag up its list scrolls the list and moves the sheet nowhere", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);
		const first = roster(page).getByRole("listitem").first();
		const firstBefore = await restingBox(first);
		const furthest = await watchHowFarItMoves(sheet);

		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			12,
		);

		const firstAfter = await restingBox(first);
		expect(firstAfter.y, "the first listener, scrolled up").toBeLessThan(
			firstBefore.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await expectTheSheetStillOpen(page);
	});
});

const HEADPHONES = {
	id: "5B0C0E5E-3C1D-4D6A-8E2F-1A2B3C4D5E6F:6A5B4C3D-2E1F-4A0B-9C8D-7E6F5A4B3C2D",
	name: "Headphones [WASAPI]",
};
const TWO_OUTPUTS = {
	outputDevices: [SPEAKERS, HEADPHONES],
	activeOutput: SPEAKERS.id,
};

const listeningInTheSheet = async (page: Page) => {
	await page.goto("/");
	await startListening(page);
	await expect
		.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
		.toBeGreaterThan(0);
	await expect(pickerSheet(page)).toBeVisible();
};

const outputOptions = (page: Page) =>
	pickerSheet(page).getByRole("button", {
		name: "Output options",
		exact: true,
	});

const outputList = (page: Page) =>
	pickerSheet(page).getByRole("radiogroup", { name: "Output device" });

test.describe("the output page behind the cog, in the picker's sheet", () => {
	test.use({ fooJean: TWO_OUTPUTS });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("the cog turns the sheet to the output devices in place, and Back turns it back to the rows", async ({
		page,
	}) => {
		await listeningInTheSheet(page);

		await outputOptions(page).click();
		await expect(outputList(page)).toBeVisible();
		await expect(outputList(page).getByRole("radio")).toHaveCount(2);
		await expect(page.getByRole("dialog")).toHaveCount(1);

		await pickerSheet(page)
			.getByRole("button", { name: "Back", exact: true })
			.click();
		await expect(
			pickerSheet(page).getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(outputList(page)).toHaveCount(0);
		await expect(stopButtons(page)).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(1);
	});
});

const SWITCH_FAILED = "We couldn’t switch the output device";

test.describe("a toast raised while the picker's sheet is open", () => {
	test.use({ fooJean: { ...TWO_OUTPUTS, outputSwitchRefusal: 500 } });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("is drawn above the sheet, so a press at its centre reaches it", async ({
		page,
	}) => {
		await listeningInTheSheet(page);
		await outputOptions(page).click();
		await outputList(page)
			.getByRole("radio", { name: HEADPHONES.name, exact: true })
			.click();

		const toast = toasts(page)
			.locator("xpath=..")
			.filter({ hasText: SWITCH_FAILED });
		await expect(toast).toBeVisible();
		await expect(pickerSheet(page)).toBeVisible();

		const box = await restingBox(toast);
		const reached = await page.evaluate(
			({ x, y, text }) => {
				const hit = document.elementFromPoint(x, y);
				return Boolean(
					hit?.closest("[data-toasts]")?.textContent?.includes(text),
				);
			},
			{
				x: box.x + box.width / 2,
				y: box.y + box.height / 2,
				text: SWITCH_FAILED,
			},
		);
		expect(reached, "the press at the toast's centre landed on it").toBe(true);

		await toast.getByRole("button", { name: "Dismiss" }).tap();
		await expect(page.getByText(SWITCH_FAILED)).toHaveCount(0);
	});
});

test.describe("the picker's touch targets on a phone", () => {
	test.use({ fooJean: TWO_OUTPUTS });
	test.skip(({ isMobile }) => !isMobile, "these are a finger's sizes");

	test("the player's face is at least 52 pixels tall", async ({ page }) => {
		await page.goto("/");
		await pickerOpener(page).click();

		await expectAtLeast(thePlayersFace(page), "the face", { height: FACE_PX });
	});

	test("Stop is at least 44 pixels tall and 64 wide", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await expectAtLeast(stopButtons(page), "Stop", {
			height: FINGER_PX,
			width: PILL_WIDTH_PX,
		});
	});

	test("the player's fader takes a touch 44 pixels tall", async ({ page }) => {
		await page.goto("/");
		await pickerOpener(page).click();

		await expectAtLeast(playerFader(page), "the fader", { height: FINGER_PX });
	});

	test("Close is at least 44 by 44", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await expectAtLeast(closeButton(page), "Close", {
			height: FINGER_PX,
			width: FINGER_PX,
		});
	});

	test("the status bar's opener and its volume button are each at least 44 by 44", async ({
		page,
	}) => {
		await page.goto("/");

		await expectAtLeast(pickerOpener(page), "the opener", {
			height: FINGER_PX,
			width: FINGER_PX,
		});
		await expectAtLeast(
			statusBar(page).getByRole("button", { name: "Show volume" }),
			"the volume button",
			{ height: FINGER_PX, width: FINGER_PX },
		);
	});
});

test.describe("the picker from the keyboard, with a track list on screen", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const SELECTED_ROW = 2;

	const keysPlayed = (player: FakePlayer) =>
		playRequests(player).length +
		countPostsTo(player, "/api/playback/play-pause");

	const withARowSelected = async (page: Page, player: FakePlayer) => {
		await openLibrary(page);
		await trackRow(page, SELECTED_ROW).click();
		await expect(trackRow(page, SELECTED_ROW)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await untilQuiet(player);
		const before = keysPlayed(player);
		return async () => {
			await untilQuiet(player);
			return keysPlayed(player) - before;
		};
	};

	const selectedRows = (page: Page) =>
		page
			.locator('main [role="row"][aria-selected="true"]')
			.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row")));

	const openThePicker = async (page: Page) => {
		await pickerOpener(page).click();
		await expect(playingOn(page)).toBeVisible();
	};

	for (const key of ["Enter", "Space"]) {
		test(`${key} on the opener opens the picker on the player's face`, async ({
			page,
			player,
		}) => {
			await withARowSelected(page, player);
			await pickerOpener(page).focus();
			await page.keyboard.press(key);

			await expect(playingOn(page)).toBeVisible();
			await expect(thePlayersFace(page)).toBeFocused();
		});

		test(`opened by ${key}, Escape gives focus back to the opener, and the list took none of the keys`, async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await pickerOpener(page).focus();
			await page.keyboard.press(key);
			await expect(thePlayersFace(page)).toBeFocused();

			await page.keyboard.press("Escape");
			await expect(playingOn(page)).toBeHidden();
			await expect(pickerOpener(page)).toBeFocused();

			expect(await played()).toBe(0);
			expect(await selectedRows(page)).toEqual([String(SELECTED_ROW)]);
		});

		test(`${key} on the player's face listens here and plays nothing in the list`, async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await openThePicker(page);
			const ticketsBefore = ticketRequests(player).length;
			await thePlayersFace(page).focus();
			await page.keyboard.press(key);

			await expect(stopButtons(page)).toBeVisible();
			expect(ticketRequests(player).length).toBeGreaterThan(ticketsBefore);
			expect(await played()).toBe(0);
		});
	}

	test("listening here, Enter on Stop stops and plays nothing in the list", async ({
		page,
		player,
	}) => {
		const played = await withARowSelected(page, player);
		await openThePicker(page);
		await thePlayersFace(page).click();
		await expect(stopButtons(page)).toBeVisible();
		await untilQuiet(player);
		const before = await played();

		await stopButtons(page).focus();
		await page.keyboard.press("Enter");

		await expect(thePlayersFace(page)).toBeVisible();
		expect(await played()).toBe(before);
	});

	test("with the picker open and focus back on the page, Space still plays and pauses", async ({
		page,
		player,
	}) => {
		await withARowSelected(page, player);
		await openThePicker(page);
		await page.evaluate(() => (document.activeElement as HTMLElement).blur());
		await untilQuiet(player);
		const before = countPostsTo(player, "/api/playback/play-pause");

		await page.keyboard.press("Space");

		await expect
			.poll(() => countPostsTo(player, "/api/playback/play-pause"))
			.toBe(before + 1);
		await expect(playingOn(page)).toBeVisible();
	});

	test.describe("with a session on offer", () => {
		test.use(OFFERING_SESSIONS);

		test("Enter on the start row starts a session here and plays nothing in the list", async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await openThePicker(page);
			await startButton(page).focus();
			await page.keyboard.press("Enter");

			await expect.poll(() => listensInItsOwn(player)).toBe(true);
			expect(await played()).toBe(0);
		});
	});
});
