import { en } from "../../src/shared/i18n/en.ts";
import { NULL_OUTPUT_DEVICE } from "../fake-api/fooJean/outputs.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	focusedEndOf,
	openLibrary,
	openSettings,
	playedFrom,
	playRequests,
	requestsTo,
	searchField,
	settingsDialog,
	sidebar,
	statusBar,
	tagWrites,
	test,
	times,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import { pressAndHold } from "./gestures.ts";

const libraryHash = (player: FakePlayer) =>
	`#/${player.playlists.find((entry) => entry.title === "Library")!.guid}`;

test.describe("the settings dialog", () => {
	test("opens over the list rather than replacing it", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(trackRow(page, 0)).toBeVisible();

		await openSettings(page);

		await expect(trackRow(page, 0)).toBeAttached();
		await expect(page).toHaveURL(new RegExp(`${libraryHash(player)}$`));
	});

	test("escape closes it, and does not clear the selection behind it", async ({
		page,
	}) => {
		test.skip(
			test.info().project.name === "mobile",
			"Escape is a keyboard route out",
		);

		await openLibrary(page);
		await trackRow(page, 3).click();
		await expect(trackRow(page, 3)).toHaveAttribute("aria-selected", "true");

		await openSettings(page);
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		// `Escape` in the playlist scope clears the selection; one press, one action.
		await expect(trackRow(page, 3)).toHaveAttribute("aria-selected", "true");
	});

	test("a click on the scrim closes it, a click inside does not", async ({
		page,
	}) => {
		test.skip(test.info().project.name === "mobile", "no scrim at this width");

		await openLibrary(page);
		await openSettings(page);

		await settingsDialog(page).click({ position: { x: 10, y: 10 } });
		await expect(settingsDialog(page)).toBeVisible();

		await page.mouse.click(4, 4);
		await expect(settingsDialog(page)).toBeHidden();
	});

	test("the close button says which key does the same, except on a phone, which has no Esc", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openSettings(page);

		const close = page.getByRole("button", { name: "Close settings" });
		if (isMobile) await expect(close.locator("kbd")).toBeHidden();
		else await expect(close.locator("kbd")).toHaveText("Esc");
		await close.click();
		await expect(settingsDialog(page)).toBeHidden();
	});

	test("Tab wraps inside the dialog, and closing it gives focus back to the button that opened it", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "Tab is a keyboard route");

		await openLibrary(page);
		await openSettings(page);
		const close = page.getByRole("button", { name: "Close settings" });

		await close.focus();
		await page.keyboard.press("Shift+Tab");
		await expect.poll(() => focusedEndOf(settingsDialog(page))).toBe("last");
		await page.keyboard.press("Tab");
		await expect(close).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();
		await expect(
			page.getByRole("button", { name: "Settings", exact: true }),
		).toBeFocused();
	});

	test("the app behind it does not answer the keyboard", async ({
		page,
		player,
	}) => {
		test.skip(
			test.info().project.name === "mobile",
			"there is no keyboard to own",
		);

		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");
		const played = playRequests(player).length;

		await openSettings(page);
		await page.keyboard.press("Space");
		await page.keyboard.press("h");

		await expect(settingsDialog(page)).toBeVisible();
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/api/playback/play-pause"),
			[],
		);
		expect(playRequests(player).length).toBe(played);
	});

	// Playwright delivers the key over CDP, past the macOS menu bar, so this
	// covers the binding rather than the browser handing the key over.
	test("mod+, opens it, and closes it again", async ({ page }) => {
		test.skip(
			test.info().project.name === "mobile",
			"there is no keyboard to press it with",
		);

		await openLibrary(page);
		await page.keyboard.press("ControlOrMeta+Comma");
		await expect(settingsDialog(page)).toBeVisible();

		await page.keyboard.press("ControlOrMeta+Comma");
		await expect(settingsDialog(page)).toBeHidden();
	});

	test.describe("on a first load", () => {
		test.use({ firstRun: true });

		test("it opens itself, once", async ({ page }) => {
			// Loaded rather than reached through the sidebar: on a first run the
			// dialog covers the sidebar too, so nothing behind it can be clicked yet.
			await page.goto("/");
			await expect(settingsDialog(page)).toBeVisible();

			await page.getByRole("button", { name: "Close settings" }).click();
			await expect(settingsDialog(page)).toBeHidden();

			await openLibrary(page);
			await page.reload();
			await expect(
				page.getByRole("heading", { level: 1, name: "Library" }),
			).toBeVisible();
			await expect(settingsDialog(page)).toBeHidden();
		});
	});

	test("foo_jean comes first", async ({ page }) => {
		await openLibrary(page);
		await openSettings(page);

		// A retrying assertion on the first heading: `allInnerTexts` is read once,
		// and the panels are still arriving when the dialog opens.
		await expect(
			settingsDialog(page).getByRole("heading", { level: 2 }).first(),
		).toHaveText("foo_jean");
	});

	test.describe("typing into a field", () => {
		test.use({
			fooJean: {},
		});

		test("the caret survives a push from the player", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await openSettings(page);

			const name = page.getByLabel("Name", { exact: true });
			await name.click();
			await name.fill("Kitchen");
			await expect(name).toBeFocused();

			// Anything the player pushes re-renders the shell, which is what hands
			// the dialog a fresh `onDismiss`.
			player.playItem("p7", 2);
			await expect(statusBar(page)).toContainText("Deléctrico");

			await expect(name).toBeFocused();
			await name.pressSequentially(" table");
			await expect(name).toHaveValue("Kitchen table");
		});
	});

	test("a hint holds the caveat, and toggles it in place", async ({ page }) => {
		await openLibrary(page);
		await openSettings(page);

		const hint = page.getByRole("button", { name: "About following" });
		const text = page.getByText(/Search results are exempt/);

		await expect(text).toBeHidden();
		await hint.click();
		await expect(text).toBeVisible();

		// Inside the dialog rather than floating over it: a popover here is clipped
		// by the body's scroller.
		await expect(settingsDialog(page)).toContainText(
			"Search results are exempt",
		);

		await hint.click();
		await expect(text).toBeHidden();
	});
});

const cursorRow = (page: Page) => page.locator('[data-cursor="true"]');

test.describe("cursor follows playback", () => {
	test("the cursor lands on the track the player moved to", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		player.playItem("p7", 6);
		await expect(statusBar(page)).toContainText("La Fox");

		await expect(cursorRow(page)).toHaveAttribute("data-row", "6");
	});

	test.describe("with a writer", () => {
		test.use({
			withoutFields: ["%lastfm_play_count%"],
			retagged: { Deléctrico: { "%rating%": "3" } },
			fooJean: {},
		});

		test("is what makes the rating keys hit the track you are hearing", async ({
			page,
			player,
		}) => {
			test.skip(
				test.info().project.name === "mobile",
				"the rating keys are a keyboard",
			);

			await openLibrary(page);
			await trackRow(page, 0).click();

			player.playItem("p7", 2);
			await expect(statusBar(page)).toContainText("Deléctrico");

			await page.keyboard.press("3");
			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			expect(tagWrites(player)[0].body).toMatchObject({
				track: expect.stringContaining("Deléctrico"),
			});
		});
	});

	test.describe("turned off", () => {
		test.use({ settings: { "jean.followPlayback": false } });

		test("the cursor stays where it was put", async ({ page, player }) => {
			await openLibrary(page);
			await trackRow(page, 1).click();
			await expect(cursorRow(page)).toHaveAttribute("data-row", "1");

			player.playItem("p7", 6);
			await expect(statusBar(page)).toContainText("La Fox");

			await expect(cursorRow(page)).toHaveAttribute("data-row", "1");
		});
	});
});

const titleAt = (player: FakePlayer, index: number) =>
	String(
		player.playlists.find((entry) => entry.id === "p7")?.items[index]?.[
			"%title%"
		],
	);

const queuedTitles = (player: FakePlayer) =>
	player.queuedEntries().map((entry) => String(entry.track["%title%"]));

test.describe("playback follows cursor", () => {
	test.use({
		settings: {
			"jean.playbackFollowsCursor": true,
			// Off, so the cursor is the one this test moves and nothing else.
			"jean.followPlayback": false,
		},
	});

	test("the next track is the row the cursor is on", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.playItem("p7", 2);
		await expect(statusBar(page)).toContainText("Deléctrico");

		await trackRow(page, 5).click();
		await expect(cursorRow(page)).toHaveAttribute("data-row", "5");

		// The player would otherwise have gone to 3.
		player.next();

		await expect(cursorRow(page)).toHaveAttribute("data-row", "5");
		await expect.poll(() => playedFrom(player)?.index).toBe(5);
	});

	// Queueing from a row's menu leaves the cursor on the last row queued. Without this the track
	// the queue hands over is replaced by that row at once, and foobar2000 empties the queue when a
	// row is played.
	test("a track that came off the queue is left playing", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		player.playItem("p7", 2);
		await expect(statusBar(page)).toContainText("Deléctrico");

		const titles = [4, 5, 6].map((index) => titleAt(player, index));
		for (const [queued, index] of [4, 5, 6].entries()) {
			const row = trackRow(page, index);
			if (isMobile) await pressAndHold(page, row);
			else await row.click({ button: "right" });
			await page.getByRole("menuitem", { name: "Add to queue" }).click();
			await expect
				.poll(() => queuedTitles(player))
				.toEqual(titles.slice(0, queued + 1));
		}

		// Jean reads the queue after the poll that announced it, so a skip sent inside that read is
		// answered by a queue the track has already left.
		await untilQuiet(player);
		player.next();
		await expect(statusBar(page)).toContainText(titles[0]);

		await expectSettlesAt(player, () => playRequests(player), []);
		await expect(statusBar(page)).toContainText(titles[0]);
		expect(queuedTitles(player)).toEqual(titles.slice(1));
	});

	test("does not fire on arrival, whatever the cursor is on", async ({
		page,
		player,
	}) => {
		// Opening a playlist puts the cursor on row 0.
		player.playItem("p7", 6);
		await openLibrary(page);
		await expect(statusBar(page)).toContainText("La Fox");

		await expectSettlesAt(player, () => playRequests(player), []);
		await expect(statusBar(page)).toContainText("La Fox");
	});

	test.describe("with the cursor following too", () => {
		test.use({
			settings: {
				"jean.playbackFollowsCursor": true,
				"jean.followPlayback": true,
			},
		});

		test("stays dormant, rather than replaying the track that ended", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			player.playItem("p7", 2);
			await expect(cursorRow(page)).toHaveAttribute("data-row", "2");

			// Without the `wasPlaying` guard this pair loops on one track forever.
			player.next();
			await expect(statusBar(page)).toContainText("Soy Rock");
			await expect(cursorRow(page)).toHaveAttribute("data-row", "3");

			// Sampled with reads that do not retry: a replay that flips the track
			// away and back would satisfy a retrying assertion at either end.
			await times(6, async () => {
				expect(await cursorRow(page).getAttribute("data-row")).toBe("3");
				expect(await statusBar(page).textContent()).toContain("Soy Rock");
				await page.waitForTimeout(100);
			});
		});
	});
});

const PERMISSIONS = "File → Preferences → Tools → Jean → Permissions";

const fooJeanPanel = (page: Page) =>
	settingsDialog(page).getByRole("region", { name: "foo_jean" });

// Scoped to the paragraph that names the switch, since the stream and field
// messages name the same Permissions page and would satisfy a panel-wide match.
const playbackRemedy = (page: Page) =>
	fooJeanPanel(page)
		.locator("p")
		.filter({ hasText: /control ?playback/i });

test.describe("single-key shortcuts", () => {
	test.skip(({ isMobile }) => isMobile, "a keyboard setting");

	const palette = (page: Page) => page.getByRole("dialog", { name: "Go to" });
	const sheet = (page: Page) =>
		page.getByRole("dialog", { name: "Keyboard shortcuts" });
	const sheetButton = (page: Page) =>
		page.getByRole("button", { name: "Keyboard shortcuts" });
	const findButton = (page: Page) =>
		page.getByRole("button", { name: "Find in this playlist" });
	const singleKeys = (page: Page) =>
		settingsDialog(page).getByRole("switch", { name: "Single-key shortcuts" });

	test("off, G does nothing and the sheet stops listing it; Mod+K and the arrows still work; on again, G works", async ({
		page,
	}) => {
		await openLibrary(page);
		await openSettings(page);
		await expect(singleKeys(page)).toBeChecked();
		await singleKeys(page).click();
		await expect(singleKeys(page)).not.toBeChecked();
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		await page.keyboard.press("g");
		await page.keyboard.press("ArrowDown");
		await expect(cursorRow(page)).toHaveAttribute("data-row", "1");
		await expect(palette(page)).toHaveCount(0);

		await expect(sidebar(page).locator("kbd")).toHaveCount(0);
		await expect(findButton(page).locator("kbd")).toHaveCount(0);

		await page.keyboard.press("ControlOrMeta+k");
		await expect(searchField(page)).toBeFocused();
		await searchField(page).blur();

		await sheetButton(page).click();
		await expect(sheet(page)).toBeVisible();
		await expect(
			sheet(page).getByText("Go to a playlist or a shelf"),
		).toHaveCount(0);
		await expect(
			sheet(page).getByRole("heading", { name: "Rating" }),
		).toHaveCount(0);
		await expect(sheet(page).getByText("Next track")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sheet(page)).toBeHidden();

		await openSettings(page);
		await singleKeys(page).click();
		await expect(singleKeys(page)).toBeChecked();
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		await expect(sidebar(page).locator("kbd")).toHaveText("G");
		await expect(findButton(page).locator("kbd")).toHaveText("/");
		await page.keyboard.press("g");
		await expect(palette(page)).toBeVisible();
	});

	test.describe("stored off", () => {
		test.use({ settings: { "jean.singleKeyShortcuts": false } });

		test("the setting is this device's, read before the first key", async ({
			page,
		}) => {
			await openLibrary(page);
			await page.keyboard.press("g");
			await sheetButton(page).click();
			await expect(sheet(page)).toBeVisible();
			await expect(palette(page)).toHaveCount(0);
			await expect(
				sheet(page).getByText("Go to a playlist or a shelf"),
			).toHaveCount(0);
		});

		test("the sheet's subtitle names the search chord alone, and the finder's key once it works again", async ({
			page,
		}) => {
			const subtitle = (page: Page) => sheet(page).locator("p");

			await openLibrary(page);
			await sheetButton(page).click();
			await expect(subtitle(page)).toContainText("searches everything.");
			await expect(subtitle(page)).not.toContainText("filters the list");
			await expect(subtitle(page).locator("kbd").last()).toHaveText("K");
			await expect(
				subtitle(page).locator("kbd").filter({ hasText: "/" }),
			).toHaveCount(0);
			await page.keyboard.press("Escape");
			await expect(sheet(page)).toBeHidden();

			await openSettings(page);
			await singleKeys(page).click();
			await expect(singleKeys(page)).toBeChecked();
			await page.keyboard.press("Escape");
			await expect(settingsDialog(page)).toBeHidden();

			await sheetButton(page).click();
			await expect(subtitle(page)).toContainText("filters the list");
			await expect(subtitle(page).locator("kbd").first()).toHaveText("/");
			await expect(subtitle(page).locator("kbd").last()).toHaveText("K");
		});
	});
});

test.describe("foo_jean refusing playback control", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	test("Settings names the switch that allows playback control, and the Permissions page it is on", async ({
		page,
	}) => {
		await openSettings(page);

		await expect(playbackRemedy(page)).toBeVisible();
		await expect(playbackRemedy(page)).toContainText(PERMISSIONS);
	});

	test.describe("with no fields and no stream as well", () => {
		test.use({
			fooJean: {
				canControlPlayback: false,
				allowedFields: [],
				canStream: false,
			},
		});

		test("each refusal keeps its own message, and none replaces another", async ({
			page,
		}) => {
			await openSettings(page);

			await expect(playbackRemedy(page)).toBeVisible();
			await expect(playbackRemedy(page)).toContainText(PERMISSIONS);
			await expect(fooJeanPanel(page)).toContainText(
				"Connected, and this install permits no fields to be written.",
			);
			await expect(fooJeanPanel(page)).toContainText(
				"does not stream audio, so Jean cannot play it on this device",
			);
		});
	});
});

test.describe("foo_jean allowing playback control", () => {
	test.use({ fooJean: { canControlPlayback: true } });

	test("Settings says nothing about the playback switch", async ({ page }) => {
		await openSettings(page);

		await expect(fooJeanPanel(page)).toContainText("Connected to foo_jean.");
		await expect(fooJeanPanel(page)).not.toContainText(/control ?playback/i);
	});
});

const OFFER_LISTENING = "Offer listening here when the player cannot be heard";
const OFFER_LISTENING_DETAIL =
	"Jean reads from foobar2000 whether its output reaches any speakers. Turn this off if it gets that wrong.";
const NO_SPEAKERS = "foobar2000 is not playing through any speakers.";

// A switch is named by everything it holds, its description included, so each is found by how its
// name begins.
const settingsSwitch = (page: Page, label: string) =>
	settingsDialog(page).getByRole("switch", {
		name: new RegExp(`^${label}`),
	});

const offerSwitch = (page: Page) => settingsSwitch(page, OFFER_LISTENING);

const closeSettings = async (page: Page) => {
	await page.getByRole("button", { name: "Close settings" }).click();
	await expect(settingsDialog(page)).toBeHidden();
};

const pickerOpener = (page: Page) =>
	statusBar(page).getByRole("button", { name: /Choose where to play/ });

const playerFace = (page: Page) =>
	page
		.getByRole("group", { name: "Playing on" })
		.getByRole("button", { name: "Listen here", exact: true });

// The fader's level arrives on the same poll as `outputSilent`, so once it is drawn the picker has
// read whether the player can be heard.
const openThePicker = async (page: Page) => {
	await pickerOpener(page).click();
	await expect(playerFace(page)).toBeVisible();
	await expect(
		page
			.getByRole("group", { name: "Playing on" })
			.getByRole("slider", { name: "Volume on foobar2000" }),
	).toBeVisible();
};

const closeThePicker = async (page: Page) => {
	await page.keyboard.press("Escape");
	await expect(page.getByRole("group", { name: "Playing on" })).toBeHidden();
};

test.describe("offering listening here when the player cannot be heard", () => {
	test.use({
		fooJean: {
			outputDevices: [
				{
					id: "5B0C0E5E-3C1D-4D6A-8E2F-1A2B3C4D5E6F:1F2E3D4C-5B6A-4978-8A9B-0C1D2E3F4A5B",
					name: "Speakers [WASAPI]",
				},
				NULL_OUTPUT_DEVICE,
			],
			activeOutput: NULL_OUTPUT_DEVICE.id,
		},
	});

	test("is the third switch in Playback, after the two following switches, says what it reads, and is on by default", async ({
		page,
	}) => {
		await openSettings(page);

		const switches = settingsDialog(page).getByRole("switch");
		await expect(offerSwitch(page)).toBeVisible();
		const names = await switches.evaluateAll((all) =>
			all.map((one) => one.textContent ?? ""),
		);
		const at = (label: string) =>
			names.findIndex((name) => name.startsWith(label));
		const cursorFollows = at("Cursor follows playback");
		expect(cursorFollows).toBeGreaterThanOrEqual(0);
		expect(at("Playback follows cursor")).toBe(cursorFollows + 1);
		expect(at(OFFER_LISTENING)).toBe(cursorFollows + 2);

		await expect(offerSwitch(page)).toContainText(OFFER_LISTENING_DETAIL);
		await expect(offerSwitch(page)).toBeChecked();
	});

	test("turned off, it stays off after a reload, and the picker no longer offers listening first", async ({
		page,
	}) => {
		await openSettings(page);
		await offerSwitch(page).click();
		await expect(offerSwitch(page)).not.toBeChecked();

		await page.reload();
		await openSettings(page);
		await expect(offerSwitch(page)).not.toBeChecked();
		await closeSettings(page);

		await openThePicker(page);
		await expect(page.getByText(NO_SPEAKERS, { exact: true })).toHaveCount(0);
	});

	test("turned off and on again, the picker offers listening first again", async ({
		page,
	}) => {
		await openSettings(page);
		await offerSwitch(page).click();
		await expect(offerSwitch(page)).not.toBeChecked();
		await closeSettings(page);

		await openThePicker(page);
		await expect(page.getByText(NO_SPEAKERS, { exact: true })).toHaveCount(0);
		await closeThePicker(page);

		await openSettings(page);
		await offerSwitch(page).click();
		await expect(offerSwitch(page)).toBeChecked();
		await closeSettings(page);

		await openThePicker(page);
		await expect(playerFace(page)).toContainText(NO_SPEAKERS);
	});
});

// What sits under a key is whatever was last written there, by any build or by hand, and a reader
// that indexes into it throws on a shape it never wrote. Nothing catches a throw in render, so the
// page went blank and stayed blank across reloads.
const NEVER_WRITTEN_BY_JEAN: Record<string, unknown> = {
	"jean.columns": {},
	"jean.fooJeanFields": null,
};

for (const [key, stored] of Object.entries(NEVER_WRITTEN_BY_JEAN))
	test.describe(`${key} stored in a shape Jean never wrote`, () => {
		test.use({ settings: { [key]: stored } });

		test("the list opens as it does with nothing stored", async ({ page }) => {
			await openLibrary(page);
			await expect(trackRow(page, 0)).toBeVisible();
		});
	});

// Every section Settings draws on a default install, in order. Jean keeps no copy of the library on
// the device, so nothing here offers to keep one or to stop.
const SECTIONS = [
	"foo_jean",
	en["settings.appearance.title"],
	en["settings.language.title"],
	en["settings.playback.title"],
	en["settings.keyboard.title"],
	en["device.title"],
	en["settings.artistInfo.title"],
	en["settings.sharedCredits.title"],
];

test("Settings draws its sections and no switch for keeping the library on this device", async ({
	page,
}) => {
	await openLibrary(page);
	await openSettings(page);

	await expect(
		settingsDialog(page).getByRole("heading", { level: 2 }),
	).toHaveText(SECTIONS);
	expect(
		await settingsDialog(page)
			.getByRole("switch", { name: /keep the library/i, includeHidden: true })
			.count(),
	).toBe(0);
});
