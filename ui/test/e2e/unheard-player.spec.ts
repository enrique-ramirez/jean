import { NULL_OUTPUT_DEVICE } from "../fake-api/fooJean/outputs.ts";
import {
	countPostsTo,
	expect,
	expectSettlesAt,
	nowPlayingScreen,
	openNowPlaying,
	openSettings,
	type Page,
	pickerOpener,
	playingOn,
	requestsTo,
	settingsDialog,
	statusBar,
	test,
	untilQuiet,
} from "./fixtures.ts";
import { dragTo } from "./gestures.ts";
import {
	currentTime,
	HAND_BACK,
	HEARD,
	marks,
	playerFader,
	playerRow,
	SPEAKERS,
	startListening,
	stopButtons,
	streamRequests,
	ticketRequests,
} from "./listening.ts";
import { thePlayersFace } from "./sessions.ts";

const NO_SPEAKERS = "foobar2000 is not playing through any speakers.";

// Both listed, as foobar2000 lists its Null Output beside the real devices, so a switch between them
// is one the player could make.
const ON_SPEAKERS = {
	outputDevices: [SPEAKERS, NULL_OUTPUT_DEVICE],
	activeOutput: SPEAKERS.id,
};
const ON_NOTHING = { ...ON_SPEAKERS, activeOutput: NULL_OUTPUT_DEVICE.id };

const noSpeakers = (page: Page) =>
	page.getByText(NO_SPEAKERS, { exact: true }).filter({ visible: true });

// The fader's level arrives on the same poll as `outputSilent`, so once it is drawn the picker
// has read whether the player can be heard, and an absence after that is not one still loading.
const openThePickerOnThePoll = async (page: Page) => {
	await pickerOpener(page).click();
	await expect(thePlayersFace(page)).toBeVisible();
	await expect(playerFader(page)).toBeVisible();
};

const expectOfferedFirst = async (page: Page) => {
	await expect(thePlayersFace(page)).toContainText(NO_SPEAKERS);
	// One target for the act: a second Listen here, or a row of its own ahead of the player's,
	// is the offer drawn beside the face rather than as it.
	await expect(
		playingOn(page).getByRole("button", { name: /listen here/i }),
	).toHaveCount(1);
	await expect(noSpeakers(page)).toHaveCount(1);
	const firstRow = playingOn(page).getByRole("listitem").first();
	await expect(firstRow).toContainText("foobar2000");
	await expect(
		firstRow.getByRole("button", { name: "Listen here", exact: true }),
	).toContainText(NO_SPEAKERS);
};

const turnOffTheOffer = async (page: Page) => {
	await openSettings(page);
	const offer = settingsDialog(page).getByRole("switch", {
		name: /^Offer listening here when the player cannot be heard/,
	});
	await offer.click();
	await expect(offer).not.toBeChecked();
	await page.getByRole("button", { name: "Close settings" }).click();
	await expect(settingsDialog(page)).toBeHidden();
};

const expectNothingOffered = async (page: Page) => {
	await expect(thePlayersFace(page)).toBeVisible();
	await expect(thePlayersFace(page)).toContainText("foobar2000");
	await expect(noSpeakers(page)).toHaveCount(0);
};

test.describe("a player nobody can hear", () => {
	test.use({ fooJean: ON_NOTHING });

	test("on the player and not listening, the player's face is the Listen here that says foobar2000 is not playing through any speakers, in the first row", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectOfferedFirst(page);
	});

	test("a press on the offered face listens, with one ticket and the stream opened", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expect(thePlayersFace(page)).toContainText(NO_SPEAKERS);

		await thePlayersFace(page).click();

		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);
	});

	test("listening here, the sentence is gone and the row reads Listening here with its Stop, and Stop brings the offer back", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		await expect(playingOn(page)).toContainText("Listening here");
		await expect(stopButtons(page)).toHaveAccessibleName(HAND_BACK);
		await expect(noSpeakers(page)).toHaveCount(0);

		await stopButtons(page).click();
		await expectOfferedFirst(page);
	});

	test("while listening is offered, the player's fader is still in its row and moves the player", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expect(thePlayersFace(page)).toContainText(NO_SPEAKERS);
		await untilQuiet(player);
		const volumes = countPostsTo(player, "/api/volume");

		const fader = playerRow(page).getByRole("slider", {
			name: "Volume on foobar2000",
		});
		await expect(fader).toBeEnabled();
		if (isMobile) {
			const box = (await fader.boundingBox())!;
			await fader.tap({ position: { x: box.width * 0.6, y: box.height / 2 } });
		} else await dragTo(page, fader, 0.6);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
	});

	test("while listening is offered, the player's row draws no bars beside its name, though the player plays", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await openThePickerOnThePoll(page);
		await expectOfferedFirst(page);

		expect(await marks(playerRow(page)).count()).toBe(0);
	});

	test("with the Settings switch off, the player's face draws its bars beside its name while it plays, as when it can be heard", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await turnOffTheOffer(page);
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
		await expect(marks(thePlayersFace(page))).toHaveCount(1);
	});

	test.describe("with playback control off", () => {
		test.use({ fooJean: { ...ON_NOTHING, canControlPlayback: false } });

		// Listening is the stream, which `foo_jean` serves whatever `canControlPlayback` says.
		test("listening is still offered first, and the press listens", async ({
			page,
			player,
		}) => {
			await page.goto("/");
			await openThePickerOnThePoll(page);

			await expectOfferedFirst(page);

			await thePlayersFace(page).click();
			await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
			await expectSettlesAt(player, () => ticketRequests(player).length, 1);
		});
	});

	test.describe("on an install that cannot stream", () => {
		test.use({ fooJean: { ...ON_NOTHING, canStream: false } });

		test("nothing is offered, and nothing says the player cannot be heard", async ({
			page,
			player,
		}) => {
			await page.goto("/");
			// Two polls asked after the first, so the first has been answered and drawn.
			await expect
				.poll(() => requestsTo(player, "/api/state").length)
				.toBeGreaterThan(2);

			await expect(pickerOpener(page)).toHaveCount(0);
			await expect(noSpeakers(page)).toHaveCount(0);
		});
	});
});

test.describe("a player whose output reaches speakers", () => {
	test.use({ fooJean: ON_SPEAKERS });

	test("is offered as before: its face is Listen here, with no sentence about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
	});

	test("its face draws the bars beside the player's name while it plays", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
		await expect(marks(thePlayersFace(page))).toHaveCount(1);
	});

	test("moved by the player onto an output nobody hears, is offered first on the next poll without a reload, and moved back is not", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await page.evaluate(() => {
			(window as unknown as { notReloaded: boolean }).notReloaded = true;
		});
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		player.setActiveOutput(NULL_OUTPUT_DEVICE.id);
		await expectOfferedFirst(page);

		player.setActiveOutput(SPEAKERS.id);
		await expect(noSpeakers(page)).toHaveCount(0);
		await expect(thePlayersFace(page)).toBeVisible();

		expect(
			await page.evaluate(
				() => (window as unknown as { notReloaded?: boolean }).notReloaded,
			),
		).toBe(true);
	});
});

test.describe("a player whose output foo_jean cannot name", () => {
	test.use({ fooJean: { activeOutput: null } });

	test("reads as audible: its face is Listen here, with no sentence about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
	});
});

// A browser falls back to an element's `title` for its description, so the opener has one whether
// or not anything is offered: what the offer adds is the sentence.
const SAYS_NO_SPEAKERS = /not playing through any speakers/;

const screenOpener = (page: Page) =>
	nowPlayingScreen(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

test.describe("the opener while listening is offered first", () => {
	test.use({ fooJean: ON_NOTHING });

	test("says foobar2000 is not playing through any speakers as its description, and keeps its name", async ({
		page,
		isMobile,
	}) => {
		await page.goto("/");

		await expect(pickerOpener(page)).toHaveAccessibleDescription(NO_SPEAKERS);
		await expect(pickerOpener(page)).toHaveAccessibleName(
			"Choose where to play",
		);

		if (!isMobile) return;
		await openNowPlaying(page);
		await expect(screenOpener(page)).toHaveAccessibleDescription(NO_SPEAKERS);
		await expect(screenOpener(page)).toHaveAccessibleName(
			"Choose where to play",
		);
	});

	test("with the Settings switch off, says nothing about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(pickerOpener(page)).toHaveAccessibleDescription(NO_SPEAKERS);

		await turnOffTheOffer(page);
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		await expect(pickerOpener(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);
	});

	test("listening here, says nothing about speakers", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect(playingOn(page)).toContainText("Listening here");
		await expect(pickerOpener(page)).toHaveAccessibleName(
			"Playing on this device",
		);

		await expect(pickerOpener(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);
	});
});

test.describe("the opener of a player whose output reaches speakers", () => {
	test.use({ fooJean: ON_SPEAKERS });

	test("says nothing about speakers, and says it once the player moves onto an output nobody hears", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		await expect(pickerOpener(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);

		player.setActiveOutput(NULL_OUTPUT_DEVICE.id);
		await expect(pickerOpener(page)).toHaveAccessibleDescription(NO_SPEAKERS);
	});
});
