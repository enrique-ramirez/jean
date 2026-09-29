import type { FakePlayer, Page } from "./fixtures.ts";
import {
	choosePlayer,
	expect,
	expectSettlesAt,
	holdThePoll,
	listenHere,
	MEDIA_SESSION_ACTIONS_WITH_CONTROL,
	mediaSessionActions,
	openLibrary,
	playingOn,
	pressAndHold,
	REASON,
	recordMediaSessionHandlers,
	refusePlaylistWrites,
	searchFor,
	statusBar,
	test,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";

const playPause = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^(Play|Pause)\b/ });

const saveAsPlaylist = (page: Page) =>
	viewHeader(page).getByRole("button", { name: /^Save as playlist\b/ });

const flip = async (page: Page, route: string, data: object) => {
	const answered = await page.request.post(`/__control/${route}`, { data });
	expect(answered.ok(), `the fake needs /__control/${route}`).toBe(true);
};

const allowPlayback = (page: Page, canControl: boolean) =>
	flip(page, "controlPlayback", { canControl });

const allowPlaylistWrites = (page: Page, canWrite: boolean) =>
	flip(page, "writePlaylists", { canWrite });

const capabilityReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === "/api/capabilities",
	).length;

// A reload would redraw from a fresh discovery and pass every assertion here,
// so the page carries a mark that only survives if it never navigated.
const LOAD_MARK = "__jeanSameLoad";

const markThisLoad = (page: Page) =>
	page.evaluate((key) => Reflect.set(window, key, true), LOAD_MARK);

const expectSameLoad = async (page: Page) =>
	expect(
		await page.evaluate((key) => Reflect.get(window, key), LOAD_MARK),
		"the page reloaded",
	).toBe(true);

const playingAtThePlayer = async (page: Page, player: FakePlayer) => {
	player.playItem("p7", 2);
	await openLibrary(page);
	await expect(statusBar(page)).toContainText("Deléctrico");
};

test.describe("a switch changed at the player while Jean is open", () => {
	test("turning playback control off disables Play/Pause with the reason on the next poll, and turning it on enables it again, with no reload", async ({
		page,
		player,
	}) => {
		await playingAtThePlayer(page, player);
		const control = playPause(page);
		await expect(control).not.toHaveAttribute("aria-disabled", "true");
		await markThisLoad(page);

		const poll = await holdThePoll(page);

		await allowPlayback(page, false);
		poll.letOneThrough();
		await expect(control).toHaveAttribute("aria-disabled", "true");
		await expect(control).toHaveAccessibleName(REASON);
		await expect(statusBar(page).getByText(REASON)).toBeVisible();

		await allowPlayback(page, true);
		poll.letOneThrough();
		await expect(control).not.toHaveAttribute("aria-disabled", "true");
		await expect(control).not.toHaveAccessibleName(REASON);
		await expect(statusBar(page).getByText(REASON)).toHaveCount(0);

		await expectSameLoad(page);
	});

	// A capabilities read follows the flip, and a listener rebuilt from it would
	// drop the stream, so each side also asks that this device is still listening.
	test("turning playback control off while listening here keeps this device's fader and narrows the media session to stop and pause on the next poll, and turning it on widens it again, with no reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordMediaSessionHandlers(page);
		await playingAtThePlayer(page, player);
		await listenHere(page);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect
			.poll(() => mediaSessionActions(page))
			.toEqual(MEDIA_SESSION_ACTIONS_WITH_CONTROL);
		await markThisLoad(page);

		const bar = statusBar(page);
		const fader = bar.getByRole("slider", { name: /^Volume\b/ });
		const expectListeningWithItsFader = async () => {
			await expect(choosePlayer(page)).toHaveAccessibleName(
				/Playing on this device/,
			);
			if (isMobile && !(await fader.isVisible()))
				await bar.getByRole("button", { name: "Show volume" }).click();
			await expect(fader).not.toHaveAttribute("aria-disabled", "true");
			await expect(fader).toHaveAccessibleName("Volume on this device");
		};
		await expectListeningWithItsFader();

		const poll = await holdThePoll(page);

		await allowPlayback(page, false);
		poll.letOneThrough();
		await expect(playPause(page)).toHaveAttribute("aria-disabled", "true");
		await expect
			.poll(() => mediaSessionActions(page))
			.toEqual(["pause", "stop"]);
		await expectListeningWithItsFader();

		await allowPlayback(page, true);
		poll.letOneThrough();
		await expect(playPause(page)).not.toHaveAttribute("aria-disabled", "true");
		await expect
			.poll(() => mediaSessionActions(page))
			.toEqual(MEDIA_SESSION_ACTIONS_WITH_CONTROL);
		await expectListeningWithItsFader();

		await expectSameLoad(page);
	});

	test("turning playlist writes off takes Save as playlist away on the next poll, and turning them on brings it back, with no reload", async ({
		page,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "babasonicos");
		await expect(saveAsPlaylist(page)).toBeVisible();
		await markThisLoad(page);

		const poll = await holdThePoll(page);

		await allowPlaylistWrites(page, false);
		poll.letOneThrough();
		await expect(saveAsPlaylist(page)).toHaveCount(0);

		await allowPlaylistWrites(page, true);
		poll.letOneThrough();
		await expect(saveAsPlaylist(page)).toBeVisible();

		await expectSameLoad(page);
	});

	// `configGeneration` exists so a client learns a switch moved without
	// asking for capabilities on every tick. A flip to the value already held
	// moves nothing at the player, so it must cost nothing here either.
	test("asks for capabilities again after a poll where configGeneration moved, and after no other", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const poll = await holdThePoll(page);
		await untilQuiet(player);
		const atLoad = capabilityReads(player);

		const quietTick = async () => {
			poll.letOneThrough();
			await poll.untilRefusedAgain();
		};

		await quietTick();
		await allowPlayback(page, true);
		await quietTick();
		await expectSettlesAt(player, () => capabilityReads(player), atLoad);

		await allowPlayback(page, false);
		poll.letOneThrough();
		await expect
			.poll(() => capabilityReads(player), {
				message: "no capabilities read followed the switch moving",
			})
			.toBeGreaterThan(atLoad);
		await untilQuiet(player);
		const afterTheMove = capabilityReads(player);

		await quietTick();
		await quietTick();
		await expectSettlesAt(player, () => capabilityReads(player), afterTheMove);
	});
});

const toast = (page: Page) => page.getByRole("status");

const refusedWrite = (page: Page) =>
	page.waitForResponse(
		(response) =>
			response.request().method() !== "GET" && response.status() === 403,
	);

const openRowMenu = async (page: Page, index: number, isMobile: boolean) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: /^Add to queue/ }),
	).toBeVisible();
};

// The poll is held throughout, so the player's own 403 is the only thing that
// can tell Jean the switch moved: a press made in the second before the next
// tick has to explain itself and redraw without waiting for that tick.
test.describe("a write that raced a switch turned off at the player", () => {
	test("a Play/Pause press refused by playback control says so in a toast, and the control turns disabled with its reason before the next poll", async ({
		page,
		player,
	}) => {
		await playingAtThePlayer(page, player);
		const control = playPause(page);
		await expect(control).not.toHaveAttribute("aria-disabled", "true");

		await holdThePoll(page);
		await allowPlayback(page, false);

		const refused = refusedWrite(page);
		await control.click();
		await refused;

		await expect(toast(page)).toContainText(REASON);
		await expect(control).toHaveAttribute("aria-disabled", "true");
		await expect(control).toHaveAccessibleName(REASON);
	});

	// The toast half is already `add.writePlaylistsOff`, which `undo.spec.ts`
	// covers; what the refusal still owes is the redraw.
	test("an add refused by playlist writes takes Add to playlist out of the row menu before the next poll", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await holdThePoll(page);
		await refusePlaylistWrites(page);

		await openRowMenu(page, 0, isMobile);
		await page.getByRole("menuitem", { name: "Add to playlist" }).click();
		const refused = refusedWrite(page);
		await page
			.getByRole("menuitem", { name: "Favorites", exact: true })
			.click();
		await refused;
		await expect(toast(page)).toContainText("writePlaylists");

		await openRowMenu(page, 1, isMobile);
		await expect(
			page.getByRole("menuitem", { name: /Add to playlist/ }),
		).toHaveCount(0);
	});
});
