import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	dragTo,
	expect,
	expectSettlesAt,
	holdThePoll,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	statusBar,
	test,
	touchDrag,
	untilQuiet,
	withNoListOnScreen,
} from "./fixtures.ts";

const OPTIONS = "Output options";
const LIST_NAME = "Output device";
const FAILED = "We couldn’t switch the output device";
const GONE =
	"That output device is no longer there. Open the list again to choose another.";

// Named the way foobar2000 lists them on Windows. The long one cannot fit on one
// line of a menu drawn at the width the mocks give it.
const LONG_NAME =
	"WASAPI (shared) : LG TV SSCR2 (NVIDIA High Definition Audio) (HDMI)";
const DEVICES = [
	{
		id: "D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:0B6E1C2D-3A4F-4B5C-8D9E-0F1A2B3C4D5E",
		name: "Primary Sound Driver",
	},
	{
		id: "D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:7C8D9E0F-1A2B-4C3D-9E4F-5A6B7C8D9E0F",
		name: "Speakers (Realtek(R) Audio) [WASAPI]",
	},
	{
		id: "D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:3E4F5A6B-7C8D-4E9F-0A1B-2C3D4E5F6A7B",
		name: LONG_NAME,
	},
];
const [PRIMARY, SPEAKERS, TV] = DEVICES;
const NAMES = DEVICES.map((device) => device.name);
const UNPLUGGED =
	"D41A7A4B-2F0B-4E4C-9A8A-5B6C7D8E9F10:99999999-9999-4999-9999-999999999999";

// Speakers rather than the first device, so a picker that ticks whatever comes
// first cannot pass.
const THREE_DEVICES = { outputDevices: DEVICES, activeOutput: SPEAKERS.id };

// ---- reading the player ----------------------------------------------------

const routeOf = (path: string) => path.split("?")[0];

const listReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "GET" && routeOf(entry.path) === "/api/outputs",
	).length;

const switchesSent = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" &&
				routeOf(entry.path) === "/api/outputs/active",
		)
		.map((entry) => entry.body);

const stateReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "GET" && routeOf(entry.path) === "/api/state",
	).length;

const capabilityReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" && routeOf(entry.path) === "/api/capabilities",
	).length;

const volumesSent = (player: FakePlayer) =>
	player.requests
		.filter((entry) => entry.method === "POST" && entry.path === "/api/volume")
		.map((entry) => entry.body ?? {});

const untilPollTicks = async (player: FakePlayer, count: number) => {
	const from = stateReads(player);
	await expect
		.poll(() => stateReads(player), { timeout: (count + 5) * 1000 })
		.toBeGreaterThanOrEqual(from + count);
};

const flip = async (page: Page, route: string, data: object) => {
	const answered = await page.request.post(`/__control/${route}`, { data });
	expect(answered.ok(), `the fake needs /__control/${route}`).toBe(true);
};

// Every message the page puts up from here on. A toast takes itself down after a
// few seconds, so "nothing was said" has to be read off a record kept from before
// the press rather than off the screen afterwards.
const watchWhatIsSaid = async (page: Page) => {
	await page.evaluate(() => {
		const said: string[] = [];
		(window as unknown as { said: string[] }).said = said;
		new MutationObserver(() => {
			for (const layer of document.querySelectorAll('[role="status"]')) {
				const text = layer.textContent ?? "";
				if (text && !said.includes(text)) said.push(text);
			}
		}).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
	return () =>
		page.evaluate(() => (window as unknown as { said: string[] }).said);
};

// A reload would read the list again from scratch and satisfy a count of one, so
// the page carries a mark that survives only if it never navigated.
const LOAD_MARK = "__jeanSameLoad";

const markThisLoad = (page: Page) =>
	page.evaluate((key) => Reflect.set(window, key, true), LOAD_MARK);

const expectSameLoad = async (page: Page) =>
	expect(
		await page.evaluate((key) => Reflect.get(window, key), LOAD_MARK),
		"the page reloaded",
	).toBe(true);

// A browser fires `visibilitychange` at the document, bubbling, and reports the
// new state through `visibilityState`; both halves are what a library listens to.
const hideAndShowTheTab = (page: Page) =>
	page.evaluate(() => {
		const become = (state: "hidden" | "visible") => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => state,
			});
			Object.defineProperty(document, "hidden", {
				configurable: true,
				get: () => state === "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
		};
		become("hidden");
		become("visible");
		Reflect.deleteProperty(document, "visibilityState");
		Reflect.deleteProperty(document, "hidden");
	});

const blurAndFocusTheWindow = (page: Page) =>
	page.evaluate(() => {
		window.dispatchEvent(new Event("blur"));
		window.dispatchEvent(new Event("focus"));
	});

// Holds every request to `path` until released. `seen` counts the ones that
// left the browser, which the fake cannot, since it has not been sent them yet.
const holdRequests = async (page: Page, path: string) => {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let seen = 0;
	await page.route(
		(url) => url.pathname === path,
		async (route) => {
			seen += 1;
			await released;
			await route.continue();
		},
	);
	return { release, seen: () => seen };
};

// ---- finding things --------------------------------------------------------

const optionsIn = (scope: Page | Locator) =>
	scope.getByRole("button", { name: OPTIONS, exact: true });

const caret = (page: Page) => optionsIn(statusBar(page));

const showVolume = (scope: Locator) =>
	scope.getByRole("button", { name: "Show volume" });

const fader = (scope: Locator) => scope.getByRole("slider", { name: /Volume/ });

const menuOf = (page: Page) => statusBar(page).getByRole("menu");

const listIn = (scope: Locator) =>
	scope.getByRole("radiogroup", { name: LIST_NAME });

const backIn = (scope: Locator) =>
	scope.getByRole("button", { name: "Back", exact: true });

const rowRole = (isMobile: boolean) => (isMobile ? "radio" : "menuitemradio");

const rowsOf = (list: Locator, isMobile: boolean) =>
	list.getByRole(rowRole(isMobile));

const rowOf = (list: Locator, isMobile: boolean, name: string) =>
	list.getByRole(rowRole(isMobile), { name, exact: true });

const playingOn = (page: Page) =>
	page.getByRole("group", { name: "Playing on" });

const listenButton = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

// The caret's menu on a desktop; on a phone the status bar's volume popover,
// turned to its list by the cog.
const openPicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) {
		const bar = statusBar(page);
		if (!(await listIn(bar).isVisible())) {
			if (!(await fader(bar).isVisible())) await showVolume(bar).click();
			await expect(optionsIn(bar)).toBeVisible();
			await optionsIn(bar).click();
		}
		await expect(listIn(bar)).toBeVisible();
		return listIn(bar);
	}
	if (!(await menuOf(page).isVisible())) {
		await expect(caret(page)).toBeVisible();
		await caret(page).click();
	}
	await expect(menuOf(page)).toBeVisible();
	return menuOf(page);
};

// Absent means no element at all, disabled or hidden included. On a phone the
// cog lives inside the popover, so the popover is opened to look.
const expectNoPicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) {
		const bar = statusBar(page);
		if (!(await fader(bar).isVisible())) await showVolume(bar).click();
		await expect(fader(bar)).toBeVisible();
	}
	expect(
		await page
			.getByRole("button", { name: OPTIONS, exact: true, includeHidden: true })
			.count(),
		"an output device picker was drawn",
	).toBe(0);
};

const expectPicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) {
		const bar = statusBar(page);
		if (!(await fader(bar).isVisible())) await showVolume(bar).click();
		await expect(optionsIn(bar)).toBeVisible();
		return;
	}
	await expect(caret(page)).toBeVisible();
};

// What a list says beyond its devices' own names, and the heading and back
// control its page carries on a phone.
const wordsBesidesNames = async (list: Locator, names: string[]) => {
	let text = await list.innerText();
	for (const name of [...names, LIST_NAME, "Back"])
		text = text.split(name).join("");
	return text.trim();
};

const sameSet = (names: string[]) => [...names].sort();

// ---- criterion 18: when the list is read ----------------------------------

test.describe("criterion 18: the list of devices is read at four moments and no others", () => {
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 18: the list is read once when the component is found, and not again across ten poll ticks", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await untilPollTicks(player, 10);
		await expectSettlesAt(player, () => listReads(player), 1);
	});

	test("criterion 18: every opening of the picker reads the list once more", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await openPicker(page, isMobile);
		await expectSettlesAt(player, () => listReads(player), 2);

		if (isMobile) await backIn(statusBar(page)).click();
		else await page.keyboard.press("Escape");

		await openPicker(page, isMobile);
		await expectSettlesAt(player, () => listReads(player), 3);
	});

	test("criterion 18: the tab coming back reads the list once more, and the window losing and regaining focus does not", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await blurAndFocusTheWindow(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await hideAndShowTheTab(page);
		await expectSettlesAt(player, () => listReads(player), 2);
	});

	// A second host of the picker mounting is not one of the four moments: the
	// list it would read is the one already held.
	test("criterion 18: opening the Playing on panel or the now-playing screen reads nothing", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await listenButton(page).click();
		await expect(playingOn(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();

		await openNowPlaying(page);
		await expectSettlesAt(player, () => listReads(player), 1);
	});

	// The tick is drawn off the poll's `outputDeviceId`, never off the `active` the
	// list answered with: the list here still says Speakers when the player moves.
	test("criterion 18: a switch made at the player moves the tick on the next poll, with no list read", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const list = await openPicker(page, isMobile);
		await expect(rowOf(list, isMobile, SPEAKERS.name)).toBeChecked();
		await untilQuiet(player);
		const readsWithTheListOpen = listReads(player);

		const poll = await holdThePoll(page);
		await flip(page, "activeOutput", { deviceId: TV.id });
		poll.letOneThrough();

		await expect(rowOf(list, isMobile, TV.name)).toBeChecked();
		await expect(rowOf(list, isMobile, SPEAKERS.name)).not.toBeChecked();
		await expectSettlesAt(
			player,
			() => listReads(player),
			readsWithTheListOpen,
		);
	});
});

test.describe("criterion 18 and 24: with changeOutput off", () => {
	test.use({ fooJean: { ...THREE_DEVICES, canChangeOutput: false } });

	test("criterion 18 and 24: the list is never read and no picker is drawn", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await untilPollTicks(player, 3);
		await openNowPlaying(page);
		await page.goBack();
		await hideAndShowTheTab(page);
		await untilPollTicks(player, 2);

		await expectSettlesAt(player, () => listReads(player), 0);
		await expectNoPicker(page, isMobile);
	});

	test("criterion 18: changeOutput turned on at the player reads the list exactly once and draws the picker, with no reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await untilQuiet(player);
		await markThisLoad(page);
		const atLoad = capabilityReads(player);
		await expectSettlesAt(player, () => listReads(player), 0);

		await flip(page, "changeOutput", { canChange: true });
		await expect
			.poll(() => capabilityReads(player), {
				message: "no capabilities read followed the switch moving",
			})
			.toBeGreaterThan(atLoad);

		await expectSettlesAt(player, () => listReads(player), 1);
		await expectPicker(page, isMobile);
		await expectSameLoad(page);
	});
});

// ---- criteria 19 and 20: choosing a device --------------------------------

test.describe("criterion 19: choosing a device", () => {
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 19: a chosen device is ticked before the player answers, one switch naming it is sent, and nothing is said once it lands", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const said = await watchWhatIsSaid(page);
		const held = await holdRequests(page, "/api/outputs/active");

		await rowOf(await openPicker(page, isMobile), isMobile, TV.name).click();
		await expect.poll(held.seen).toBe(1);

		const list = await openPicker(page, isMobile);
		await expect(rowOf(list, isMobile, TV.name)).toBeChecked();
		await expect(
			list.getByRole(rowRole(isMobile), { checked: true }),
		).toHaveCount(1);
		expect(switchesSent(player), "the fake saw the held switch").toEqual([]);

		const landed = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/api/outputs/active" &&
				response.status() === 204,
		);
		held.release();
		await landed;

		await expectSettlesAt(player, () => switchesSent(player), [
			{ deviceId: TV.id },
		]);
		await expect(rowOf(list, isMobile, TV.name)).toBeChecked();
		expect(await said()).toEqual([]);
	});
});

test.describe("criterion 19: a switch the player refuses", () => {
	test.use({ fooJean: { ...THREE_DEVICES, outputSwitchRefusal: 500 } });

	test("criterion 19: a refused switch puts the tick back and says the switch failed", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const said = await watchWhatIsSaid(page);
		// Held so no tick can put Speakers back on its own: the rollback is the only
		// thing left that can.
		await holdThePoll(page);

		await rowOf(await openPicker(page, isMobile), isMobile, TV.name).click();
		await expect
			.poll(() => switchesSent(player))
			.toEqual([{ deviceId: TV.id }]);

		await expect(page.getByRole("status")).toContainText(FAILED);
		const list = await openPicker(page, isMobile);
		await expect(rowOf(list, isMobile, SPEAKERS.name)).toBeChecked();
		await expect(rowOf(list, isMobile, TV.name)).not.toBeChecked();
		expect((await said()).join(" ")).toContain(FAILED);
	});
});

test.describe("criterion 20: a switch to a device the player no longer lists", () => {
	test.use({ fooJean: { ...THREE_DEVICES, outputSwitchRefusal: 409 } });

	test("criterion 20: a 409 says the device is no longer there, rather than that the switch failed", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const said = await watchWhatIsSaid(page);

		await rowOf(await openPicker(page, isMobile), isMobile, TV.name).click();
		await expect(page.getByRole("status")).toContainText(GONE);
		await untilQuiet(player);

		const everything = (await said()).join(" ");
		expect(everything).toContain(GONE);
		expect(everything).not.toContain(FAILED);
	});
});

// ---- criterion 21: the caret on a wide viewport ---------------------------

test.describe("criterion 21: the caret beside the status bar's volume", () => {
	test.skip(({ isMobile }) => isMobile, "the caret is the wide status bar's");
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 21: the caret sits beside the volume icon, is named Output options, and opens the devices above it with no heading and nothing in between", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		const mute = statusBar(page).getByRole("button", {
			name: /^(Mute|Unmute)$/,
		});
		await expect(caret(page)).toBeVisible();
		await expect(caret(page)).toHaveAttribute("title", OPTIONS);

		const icon = (await mute.boundingBox())!;
		const at = (await caret(page).boundingBox())!;
		const gap = Math.max(
			at.x - (icon.x + icon.width),
			icon.x - (at.x + at.width),
		);
		expect(gap, "the caret is not beside the volume icon").toBeLessThanOrEqual(
			16,
		);
		expect(
			Math.abs(at.y + at.height / 2 - (icon.y + icon.height / 2)),
		).toBeLessThanOrEqual(8);

		await caret(page).click();
		const menu = menuOf(page);
		await expect(menu).toBeVisible();

		const box = (await menu.boundingBox())!;
		expect(
			box.y + box.height,
			"the menu did not open upward",
		).toBeLessThanOrEqual(at.y + 1);

		await expect(rowsOf(menu, false)).toHaveCount(DEVICES.length);
		expect(sameSet(await rowsOf(menu, false).allInnerTexts())).toEqual(
			sameSet(NAMES),
		);
		await expect(menu.getByRole("menuitem")).toHaveCount(0);
		await expect(menu.getByRole("heading")).toHaveCount(0);
		expect(await wordsBesidesNames(menu, NAMES)).toBe("");
	});

	test("criterion 21: arrow keys move through the devices, and Escape closes the list and hands focus back to the caret", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await expect(caret(page)).toBeVisible();
		await caret(page).click();
		const rows = rowsOf(menuOf(page), false);
		await expect(rows).toHaveCount(DEVICES.length);

		await page.keyboard.press("ArrowDown");
		await expect(rows.nth(0)).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(rows.nth(1)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(rows.nth(0)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(menuOf(page)).toBeHidden();
		await expect(caret(page)).toBeFocused();
	});

	// Choosing unmounts the row that held focus, and a browser then drops focus on
	// <body>, so a keyboard user starts over from the top of the page.
	test("criterion 21: choosing a device with Enter sends the switch and hands focus back to the caret", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await expect(caret(page)).toBeVisible();
		await caret(page).focus();
		await page.keyboard.press("Enter");
		const rows = rowsOf(menuOf(page), false);
		await expect(rows).toHaveCount(DEVICES.length);

		let chosen = "";
		for (let step = 0; step < DEVICES.length && !chosen; step += 1) {
			await page.keyboard.press("ArrowDown");
			const focused = menuOf(page).locator(":focus");
			if ((await focused.getAttribute("aria-checked")) !== "true")
				chosen = await focused.innerText();
		}
		const device = DEVICES.find((entry) => entry.name === chosen);
		expect(
			device,
			"no row that is not the active one took focus",
		).toBeDefined();

		await page.keyboard.press("Enter");
		await expectSettlesAt(player, () => switchesSent(player), [
			{ deviceId: device?.id },
		]);
		await expect(menuOf(page)).toBeHidden();
		await expect(caret(page)).toBeFocused();
	});

	test("criterion 21: a long device name wraps inside the list rather than being cut off", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await expect(caret(page)).toBeVisible();
		await caret(page).click();
		const menu = menuOf(page);
		const long = rowOf(menu, false, LONG_NAME);
		const short = rowOf(menu, false, PRIMARY.name);
		await expect(long).toHaveText(LONG_NAME);

		const tall = (await long.boundingBox())!.height;
		const line = (await short.boundingBox())!.height;
		expect(tall, "the long name stayed on one line").toBeGreaterThan(
			line * 1.5,
		);

		const clipped = await long.evaluate((row) =>
			[row, ...row.querySelectorAll("*")].some(
				(element) => element.scrollWidth > element.clientWidth + 1,
			),
		);
		expect(clipped, "part of the long name is cut off").toBe(false);

		const box = (await menu.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	});
});

// ---- criterion 22: the cog in the volume popover --------------------------

test.describe("criterion 22: the cog in the phone's volume popover", () => {
	test.skip(({ isMobile }) => !isMobile, "the volume popover is compact-only");
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 22: the cog under the status bar's fader swaps the fader for the devices inside the popover, and Back returns to the fader", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		const bar = statusBar(page);
		await expect(optionsIn(bar)).toHaveCount(0);

		await showVolume(bar).click();
		await expect(fader(bar)).toBeVisible();
		const cog = optionsIn(bar);
		await expect(cog).toBeVisible();
		const slider = (await fader(bar).boundingBox())!;
		expect(
			(await cog.boundingBox())!.y,
			"the cog is not under the fader",
		).toBeGreaterThanOrEqual(slider.y + slider.height);

		await cog.click();
		// Inside the status bar rather than portalled to <body>, which the popover
		// would read as a press outside it and close.
		await expect(listIn(bar)).toBeVisible();
		await expect(rowsOf(listIn(bar), true)).toHaveCount(DEVICES.length);
		await expect(fader(bar)).toHaveCount(0);

		await backIn(bar).click();
		await expect(fader(bar)).toBeVisible();
		await expect(listIn(bar)).toHaveCount(0);
	});

	test("criterion 22: choosing a device leaves the popover open on the list", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		const list = await openPicker(page, true);

		await rowOf(list, true, TV.name).click();
		await expectSettlesAt(player, () => switchesSent(player), [
			{ deviceId: TV.id },
		]);

		expect(await list.isVisible(), "choosing closed the popover").toBe(true);
		await expect(rowOf(list, true, TV.name)).toBeChecked();
	});

	test("criterion 22: the now-playing screen's volume popover carries the same cog and list", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);

		await showVolume(screen).click();
		await expect(optionsIn(screen)).toBeVisible();
		await optionsIn(screen).click();
		await expect(listIn(screen)).toBeVisible();
		await expect(rowOf(listIn(screen), true, SPEAKERS.name)).toBeChecked();
		await expect(fader(screen)).toHaveCount(0);

		await backIn(screen).click();
		await expect(fader(screen)).toBeVisible();
	});
});

test.describe("criterion 22: the desktop now-playing screen", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the wide layout keeps the status bar under the screen",
	);
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 22: the desktop now-playing screen offers the status bar's caret and no cog", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await openNowPlaying(page);

		await expect(caret(page)).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: OPTIONS,
				exact: true,
				includeHidden: true,
			}),
		).toHaveCount(1);
		await expect(page.getByRole("button", { name: "Show volume" })).toHaveCount(
			0,
		);
	});
});

// ---- criterion 23: while listening here -----------------------------------

test.describe("criterion 23: while listening in this browser", () => {
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 23: the status bar draws neither caret nor cog, and the Playing on panel's foobar2000 row carries the cog", async ({
		page,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await listenHere(page);

		const panel = playingOn(page);
		const cog = optionsIn(panel);
		await expect(cog).toBeVisible();
		const listening = panel.getByRole("button", { name: /listening here/i });
		expect(
			(await cog.boundingBox())!.y + (await cog.boundingBox())!.height,
			"the cog is not in the player's row",
		).toBeLessThanOrEqual((await listening.boundingBox())!.y);

		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();

		const bar = statusBar(page);
		if (isMobile) await showVolume(bar).click();
		await expect(
			bar.getByRole("slider", { name: "Volume on this device" }),
		).toBeVisible();
		expect(
			await page
				.getByRole("button", {
					name: OPTIONS,
					exact: true,
					includeHidden: true,
				})
				.count(),
			"the status bar drew a picker beside this device's own fader",
		).toBe(0);
	});

	// The panel's page is the same radio list the volume popover turns to, on
	// either viewport.
	test("criterion 23: the Playing on panel's cog swaps the panel for the devices in place, and Back returns to the panel", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await listenHere(page);
		const bar = statusBar(page);

		await expect(optionsIn(playingOn(page))).toBeVisible();
		await optionsIn(playingOn(page)).click();
		await expect(listIn(bar)).toBeVisible();
		await expect(rowOf(listIn(bar), true, SPEAKERS.name)).toBeChecked();
		await expect(
			bar.getByRole("button", { name: /^(Listen here|Stop listening here)$/ }),
		).toHaveCount(0);

		await backIn(bar).click();
		await expect(playingOn(page)).toBeVisible();
		await expect(listIn(bar)).toHaveCount(0);
	});
});

// ---- criterion 24: when the picker is drawn at all ------------------------

test.describe("criterion 24: with playback control off and changeOutput on", () => {
	test.use({ fooJean: { ...THREE_DEVICES, canControlPlayback: false } });

	test("criterion 24: the picker is still drawn", async ({
		page,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await expectPicker(page, isMobile);
	});
});

test.describe("criterion 24: an install with one output device", () => {
	test.use({
		fooJean: { outputDevices: [SPEAKERS], activeOutput: SPEAKERS.id },
	});

	test("criterion 24: one device draws no picker at all", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);
		await expectNoPicker(page, isMobile);
	});
});

test.describe("criterion 24: an install with two output devices", () => {
	test.use({
		fooJean: { outputDevices: [PRIMARY, SPEAKERS], activeOutput: SPEAKERS.id },
	});

	test("criterion 24: two devices draw the picker", async ({
		page,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await expectPicker(page, isMobile);
	});
});

test.describe("criterion 24: before the list has answered", () => {
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 24: no picker is drawn until the first list has answered", async ({
		page,
		isMobile,
	}) => {
		const held = await holdRequests(page, "/api/outputs");
		await withNoListOnScreen(page);
		await expect.poll(held.seen).toBeGreaterThanOrEqual(1);

		await expectNoPicker(page, isMobile);

		held.release();
		await expectPicker(page, isMobile);
	});
});

// ---- criteria 25 and 26: what the list marks ------------------------------

test.describe("criterion 25: the list is a single choice", () => {
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 25: every device is a single-choice row and exactly the active one is marked", async ({
		page,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const list = await openPicker(page, isMobile);
		const rows = rowsOf(list, isMobile);

		await expect(rows).toHaveCount(DEVICES.length);
		expect(sameSet(await rows.allInnerTexts())).toEqual(sameSet(NAMES));
		await expect(
			list.getByRole(rowRole(isMobile), { checked: true }),
		).toHaveCount(1);
		await expect(rowOf(list, isMobile, SPEAKERS.name)).toBeChecked();
	});
});

test.describe("criterion 26: the player pointed at a device it no longer lists", () => {
	test.use({ fooJean: { outputDevices: DEVICES, activeOutput: UNPLUGGED } });

	test("criterion 26: the list opens with every device drawn, none marked, no extra row and nothing said about the missing one", async ({
		page,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		const list = await openPicker(page, isMobile);
		const rows = rowsOf(list, isMobile);

		await expect(rows).toHaveCount(DEVICES.length);
		expect(sameSet(await rows.allInnerTexts())).toEqual(sameSet(NAMES));
		await expect(
			list.getByRole(rowRole(isMobile), { checked: true }),
		).toHaveCount(0);
		expect(await wordsBesidesNames(list, NAMES)).toBe("");
	});
});

// ---- criterion 16: the volume does not answer to changeOutput -------------

test.describe("criterion 16: the volume with changeOutput off", () => {
	test.use({
		fooJean: { ...THREE_DEVICES, activeOutput: TV.id, canChangeOutput: false },
	});

	test("criterion 16: the status bar's fader drags and writes, mute toggles, the keys step, and the Playing on panel's fader writes", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"dragging a fader with a mouse and the keymap are desktop's",
		);
		await openLibrary(page);
		const bar = statusBar(page);

		const slider = bar.getByRole("slider", { name: "Volume", exact: true });
		await expect(slider).not.toHaveAttribute("aria-disabled", "true");
		await dragTo(page, slider, 0.5);
		await expect
			.poll(() => volumesSent(player).filter((body) => "value" in body).length)
			.toBeGreaterThan(0);

		await bar.getByRole("button", { name: "Mute", exact: true }).click();
		await expect.poll(() => player.player.volume.isMuted).toBe(true);

		await page.keyboard.press("=");
		await expect
			.poll(() => volumesSent(player).some((body) => body.step === "up"))
			.toBe(true);

		await listenButton(page).click();
		const own = playingOn(page).getByRole("slider", { name: /^Volume on / });
		await expect(own).not.toHaveAttribute("aria-disabled", "true");
		const before = volumesSent(player).length;
		await dragTo(page, own, 0.3);
		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(before);
	});

	test("criterion 16: the phone's volume popover fader still writes", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(!isMobile, "the volume popover is compact-only");
		await withNoListOnScreen(page);
		const bar = statusBar(page);
		await showVolume(bar).click();

		const slider = fader(bar);
		await expect(slider).not.toHaveAttribute("aria-disabled", "true");
		const box = (await slider.boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.85 },
			{ x, y: box.y + box.height * 0.2 },
		);
		await expect
			.poll(() => volumesSent(player).filter((body) => "value" in body).length)
			.toBeGreaterThan(0);
	});
});

// ---- criterion 28: the fake ----------------------------------------------

test.describe("criterion 28: the fake's own defaults", () => {
	test("criterion 28: GET /api/state names the output device the fake is set to, and a switch moves it", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a wire-only case; nothing here is on a screen");

		const listed = await page.request.get("/api/outputs");
		expect(listed.status(), "the fake answers GET /api/outputs").toBe(200);
		const outputs = await listed.json();
		const before = await (await page.request.get("/api/state")).json();
		expect(before.player).toHaveProperty("outputDeviceId");
		expect(outputs.devices.length).toBeGreaterThan(1);
		expect(before.player.outputDeviceId).toBe(outputs.active);

		const other = outputs.devices.find(
			(device: { id: string }) => device.id !== outputs.active,
		);
		const switched = await page.request.post("/api/outputs/active", {
			data: { deviceId: other.id },
		});
		expect(switched.status()).toBe(204);

		const after = await (await page.request.get("/api/state")).json();
		expect(after.player.outputDeviceId).toBe(other.id);
	});

	test("criterion 28: the picker is drawn with no fixture override, listing what the fake lists and marking what it is set to", async ({
		page,
		isMobile,
	}) => {
		const listed = await page.request.get("/api/outputs");
		expect(listed.status(), "the fake answers GET /api/outputs").toBe(200);
		const outputs = await listed.json();
		const names = outputs.devices.map(
			(device: { name: string }) => device.name,
		);
		const active = outputs.devices.find(
			(device: { id: string }) => device.id === outputs.active,
		);

		await withNoListOnScreen(page);
		const list = await openPicker(page, isMobile);
		const rows = rowsOf(list, isMobile);
		await expect(rows).toHaveCount(names.length);
		expect(sameSet(await rows.allInnerTexts())).toEqual(sameSet(names));
		await expect(rowOf(list, isMobile, active.name)).toBeChecked();
	});
});

// ---- from the audit --------------------------------------------------------

// The fewest device rows the status bar drew at any moment since the list
// first appeared. A picker that blinks out and back between two reads passes
// every assertion made after it has come back, so this is kept from before.
const watchFewestRows = async (page: Page) => {
	await page.evaluate(() => {
		const store = window as unknown as { fewestRows: number | null };
		store.fewestRows = null;
		const look = () => {
			const count = document.querySelectorAll(
				'footer [role="menuitemradio"], footer [role="radio"]',
			).length;
			if (count === 0 && store.fewestRows === null) return;
			store.fewestRows =
				store.fewestRows === null ? count : Math.min(store.fewestRows, count);
		};
		new MutationObserver(look).observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		});
	});
	return () =>
		page.evaluate(
			() => (window as unknown as { fewestRows: number | null }).fewestRows,
		);
};

const closePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) await backIn(statusBar(page)).click();
	else await page.keyboard.press("Escape");
};

test.describe("criterion 24: a list read that fails", () => {
	test.use({ fooJean: THREE_DEVICES });

	// `orNull` answers null for any failure. Stored as the list, that null
	// empties the devices and takes the picker away until the next good read.
	test("criterion 24: a failed read keeps the last list Jean read, and the next opening reads again", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);
		await expectPicker(page, isMobile);

		let refused = 0;
		await page.route(
			(url) => url.pathname === "/api/outputs",
			async (route) => {
				if (refused > 0) return route.continue();
				refused += 1;
				return route.fulfill({ status: 504, body: "" });
			},
		);
		const failed = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/api/outputs" &&
				response.status() === 504,
		);
		const fewest = await watchFewestRows(page);

		const list = await openPicker(page, isMobile);
		await failed;
		await untilQuiet(player);

		expect(await fewest(), "the list lost its devices").toBe(DEVICES.length);
		expect(await rowsOf(list, isMobile).count()).toBe(DEVICES.length);

		await closePicker(page, isMobile);
		await expectPicker(page, isMobile);

		const reopened = await openPicker(page, isMobile);
		await expectSettlesAt(player, () => listReads(player), 2);
		await expect(rowsOf(reopened, isMobile)).toHaveCount(DEVICES.length);
		await expect(rowOf(reopened, isMobile, SPEAKERS.name)).toBeChecked();
	});
});

// Every box the paged popover draws, which on a narrow phone is what runs off
// the edge first.
const expectInside = async (page: Page, scope: Locator) => {
	const width = page.viewportSize()?.width ?? 0;
	const boxes = [
		["the list", listIn(scope)],
		["Back", backIn(scope)],
		["the heading", scope.getByRole("heading", { name: LIST_NAME })],
		...(await rowsOf(listIn(scope), true).all()).map(
			(row, index) => [`row ${index}`, row] as const,
		),
	] as const;
	for (const [what, locator] of boxes) {
		const box = (await locator.boundingBox())!;
		expect(
			box.x,
			`${what} ran off the left at ${width}px`,
		).toBeGreaterThanOrEqual(0);
		expect(
			box.x + box.width,
			`${what} ran off the right at ${width}px`,
		).toBeLessThanOrEqual(width);
	}
};

for (const width of [320, 360]) {
	test.describe(`criterion 22: the paged volume popover on a phone ${width}px wide`, () => {
		test.skip(
			({ isMobile }) => !isMobile,
			"the volume popover is compact-only",
		);
		test.use({ fooJean: THREE_DEVICES, viewport: { width, height: 740 } });

		test(`criterion 22: at ${width}px the status bar's paged popover stays inside the screen`, async ({
			page,
		}) => {
			await withNoListOnScreen(page);
			await openPicker(page, true);
			await expectInside(page, statusBar(page));
		});

		test(`criterion 22: at ${width}px the now-playing screen's paged popover stays inside the screen`, async ({
			page,
		}) => {
			await withNoListOnScreen(page);
			await openNowPlaying(page);
			const screen = nowPlayingScreen(page);
			await showVolume(screen).click();
			await expect(optionsIn(screen)).toBeVisible();
			await optionsIn(screen).click();
			await expect(listIn(screen)).toBeVisible();
			await expectInside(page, screen);
		});
	});
}

// The size every other compact control here is drawn at, and what the fader's
// own case in `sliders.spec.ts` holds it to.
const TOUCH_TARGET_PX = 44;

test.describe("criterion 22: touch targets in the phone's volume popover", () => {
	test.skip(({ isMobile }) => !isMobile, "a touch target is the phone's");
	test.use({ fooJean: THREE_DEVICES });

	test("criterion 22: the cog and Back are each at least a finger's width and height", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		const bar = statusBar(page);
		await showVolume(bar).click();
		const cog = (await optionsIn(bar).boundingBox())!;
		expect(cog.width, "the cog's width").toBeGreaterThanOrEqual(
			TOUCH_TARGET_PX,
		);
		expect(cog.height, "the cog's height").toBeGreaterThanOrEqual(
			TOUCH_TARGET_PX,
		);

		await optionsIn(bar).click();
		const back = (await backIn(bar).boundingBox())!;
		expect(back.width, "Back's width").toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
		expect(back.height, "Back's height").toBeGreaterThanOrEqual(
			TOUCH_TARGET_PX,
		);
	});
});

// The row a keyboard user expects to land on when the list turns up: the one
// that is checked, or the first where none is.
const expectPagedFocus = async (scope: Locator) => {
	const rows = rowsOf(listIn(scope), true);
	await expect(rows.first()).toBeVisible();
	const checked = await rows.evaluateAll((all) =>
		all.findIndex((row) => row.getAttribute("aria-checked") === "true"),
	);
	const at = Math.max(checked, 0);
	await expect(rows.nth(at)).toBeFocused();

	const down = (at + 1) % DEVICES.length;
	await scope.page().keyboard.press("ArrowDown");
	await expect(rows.nth(down)).toBeFocused();
	await scope.page().keyboard.press("ArrowUp");
	await expect(rows.nth(at)).toBeFocused();
};

test.describe("criterion 22 and 23: paging with the keyboard", () => {
	test.use({ fooJean: THREE_DEVICES });

	// Paging unmounts the button that held focus, and a browser then drops focus
	// on <body>.
	test("criterion 22: the popover's cog pressed from the keyboard lands on the checked device, the arrows move between devices, and Back lands on the cog", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the volume popover is compact-only");
		await withNoListOnScreen(page);
		const bar = statusBar(page);
		await showVolume(bar).click();

		await optionsIn(bar).focus();
		await page.keyboard.press("Enter");
		await expectPagedFocus(bar);

		await backIn(bar).focus();
		await page.keyboard.press("Enter");
		await expect(optionsIn(bar)).toBeFocused();
	});

	test("criterion 23: the Playing on panel's cog pressed from the keyboard lands on the checked device, the arrows move between devices, and Back lands on the cog", async ({
		page,
	}) => {
		await withNoListOnScreen(page);
		await listenHere(page);
		const bar = statusBar(page);

		await expect(optionsIn(playingOn(page))).toBeVisible();
		await optionsIn(playingOn(page)).focus();
		await page.keyboard.press("Enter");
		await expectPagedFocus(bar);

		await backIn(bar).focus();
		await page.keyboard.press("Enter");
		await expect(optionsIn(playingOn(page))).toBeFocused();
	});
});

test.describe("criterion 18: the network coming back", () => {
	test.use({ fooJean: THREE_DEVICES });

	// Coming back online is not one of the four moments, and react-query reads
	// every stale query again on it unless told not to.
	test("criterion 18: the browser going offline and online again reads nothing", async ({
		page,
		context,
		player,
	}) => {
		await withNoListOnScreen(page);
		await expectSettlesAt(player, () => listReads(player), 1);

		await context.setOffline(true);
		await page.evaluate(() => window.dispatchEvent(new Event("offline")));
		await context.setOffline(false);
		await page.evaluate(() => window.dispatchEvent(new Event("online")));

		await untilPollTicks(player, 2);
		await expectSettlesAt(player, () => listReads(player), 1);
	});
});
