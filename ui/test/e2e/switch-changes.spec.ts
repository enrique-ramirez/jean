import type { FakePlayer, Page } from "./fixtures.ts";
import {
	countPostsTo,
	expect,
	expectSettlesAt,
	globalControls,
	guidOfPlaylist,
	holdThePoll,
	listenHere,
	MEDIA_SESSION_ACTIONS_WITH_CONTROL,
	mediaSessionActions,
	openLibrary,
	orderButton,
	pickerOpener,
	playbackOffToast,
	playingAtThePlayer,
	playingOn,
	REASON,
	recordMediaSessionHandlers,
	refusedAsks,
	refusePlaylistWrites,
	revealSearch,
	scratchOf,
	searchField,
	searchFor,
	statusBar,
	test,
	toastRegion,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import { dragTo } from "./gestures.ts";
import { openRowMenu } from "./menus.ts";

const playPause = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^(Play|Pause)\b/ });

const statusBarVolume = (page: Page) =>
	statusBar(page).getByRole("slider", { name: /^Volume\b/ });

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
			await expect(pickerOpener(page)).toHaveAccessibleName(
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

	test("turning playlist writes off takes Sort, the row grips and the keyboard move away on the next poll, with no reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto(`/#/${guidOfPlaylist(player, "p5")}`);
		await expect(trackRow(page, 1)).toBeAttached();
		const sort = viewHeader(page).getByRole("button", {
			name: "Sort",
			exact: true,
		});
		const grips = page
			.locator("main")
			.getByRole("button", { name: "Drag to reorder", includeHidden: true });
		await expect(sort).toBeVisible();
		if (!isMobile) await trackRow(page, 0).hover();
		await expect(grips.first()).toBeAttached();
		await markThisLoad(page);

		const poll = await holdThePoll(page);
		await allowPlaylistWrites(page, false);
		poll.letOneThrough();
		await expect(sort).toHaveCount(0);
		await expect(grips).toHaveCount(0);

		if (!isMobile) {
			await trackRow(page, 1).click();
			await page.keyboard.press("Alt+ArrowDown");
			await expectSettlesAt(
				player,
				() =>
					player.requests.filter(
						(entry) =>
							entry.method === "POST" && entry.path.endsWith("/items/move"),
					).length,
				0,
			);
		}

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

const refusedWrite = (page: Page) =>
	page.waitForResponse(
		(response) =>
			response.request().method() !== "GET" && response.status() === 403,
	);

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

		await expect(toastRegion(page)).toContainText(REASON);
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

		await openRowMenu(page, isMobile, 0, /^Add to queue/);
		await page.getByRole("menuitem", { name: "Add to playlist" }).click();
		const refused = refusedWrite(page);
		await page
			.getByRole("menuitem", { name: "Favorites", exact: true })
			.click();
		await refused;
		await expect(toastRegion(page)).toContainText("writePlaylists");

		await openRowMenu(page, isMobile, 1, /^Add to queue/);
		await expect(
			page.getByRole("menuitem", { name: /Add to playlist/ }),
		).toHaveCount(0);
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
