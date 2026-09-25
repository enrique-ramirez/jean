import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	dragFrom,
	expect,
	expectSettlesAt,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	pressAndHold,
	searchFor,
	statusBar,
	test,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

// The fragment every refused control's name and every visible line must carry.
const REASON = /playback control is off/i;

// The fourteen routes a player with `controlPlayback` off answers `403`.
const REFUSED_ROUTES = [
	/^POST \/api\/playback\//,
	/^POST \/api\/volume$/,
	/^POST \/api\/playlists\/[^/]+\/items\/\d+\/play$/,
	/^(POST|DELETE) \/api\/queue(\/move|\/\d+)?$/,
	/^(POST|DELETE) \/api\/playlists\/own\/scratch\/items$/,
];

const refusedAsks = (player: FakePlayer) =>
	player.requests
		.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`)
		.filter((route) => REFUSED_ROUTES.some((pattern) => pattern.test(route)));

const expectNothingRefusedSent = (player: FakePlayer) =>
	expectSettlesAt(player, () => refusedAsks(player), []);

// `aria-disabled` rather than `disabled`, so a keyboard can still land on the
// control and hear why it does nothing.
const expectDisabledWithReason = async (control: Locator) => {
	await expect(control).toBeVisible();
	await expect(control).toHaveAttribute("aria-disabled", "true");
	await expect(control).toHaveAccessibleName(REASON);
	await control.focus();
	await expect(control).toBeFocused();
};

const button = (scope: Locator, name: RegExp) =>
	scope.getByRole("button", { name });

const slider = (scope: Locator, name: RegExp) =>
	scope.getByRole("slider", { name });

const PLAY_PAUSE = /^(Play|Pause)\b/;
const PREVIOUS = /^Previous track\b/;
const NEXT = /^Next track\b/;
const SHUFFLE = /^Shuffle\b/;
const POSITION = /^Playback position\b/;

const playingAtThePlayer = async (page: Page, player: FakePlayer) => {
	player.playItem("p7", 2);
	await openLibrary(page);
	await expect(statusBar(page)).toContainText("Deléctrico");
};

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const queueButton = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^Queue/ });

const openQueue = async (page: Page) => {
	if (!(await queueButton(page).count())) await openNowPlaying(page);
	const opener = (await queueButton(page).count())
		? queueButton(page)
		: nowPlayingScreen(page).getByRole("button", { name: /^Queue/ });
	await opener.click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
};

test.describe("with playback control off at the player", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	test("the status bar keeps every transport control, each disabled and named with the reason, and pressing one sends nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await playingAtThePlayer(page, player);
		const bar = statusBar(page);

		const controls = isMobile
			? [button(bar, PLAY_PAUSE), slider(bar, POSITION)]
			: [
					button(bar, SHUFFLE),
					button(bar, PREVIOUS),
					button(bar, PLAY_PAUSE),
					button(bar, NEXT),
					slider(bar, POSITION),
					button(bar, /^(Mute|Unmute)\b/),
					slider(bar, /^Volume\b/),
				];

		for (const control of controls) await expectDisabledWithReason(control);

		// A control that is only `aria-disabled` still receives the click, so this
		// is what proves the handler was taken away and not just the look.
		for (const control of controls) await control.click({ force: true });
		await expectNothingRefusedSent(player);
	});

	test("the status bar says why once, as text beside the transport", async ({
		page,
		player,
	}) => {
		await playingAtThePlayer(page, player);

		const line = statusBar(page).getByText(REASON);
		await expect(line).toHaveCount(1);
		await expect(line).toBeVisible();
	});

	test("the now-playing screen keeps its transport, disabled with the reason, and says why once", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the screen draws a transport only on a phone; on a desktop the status bar is it",
		);

		await playingAtThePlayer(page, player);
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);

		for (const control of [
			button(screen, SHUFFLE),
			button(screen, PREVIOUS),
			button(screen, PLAY_PAUSE),
			button(screen, NEXT),
			slider(screen, POSITION),
		])
			await expectDisabledWithReason(control);

		const line = screen.getByText(REASON);
		await expect(line).toHaveCount(1);
		await expect(line).toBeVisible();
	});

	test("Play and Shuffle stay drawn on Home, All music and search results, disabled with the reason", async ({
		page,
	}) => {
		const expectHeaderRefuses = async () => {
			await expectDisabledWithReason(button(viewHeader(page), /^Play\b/));
			await expectDisabledWithReason(button(viewHeader(page), SHUFFLE));
		};

		await page.goto("/");
		await expectHeaderRefuses();

		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectHeaderRefuses();

		await searchFor(page, "babasonicos");
		await expectHeaderRefuses();
	});

	test("a track's menu offers Add to queue as a disabled item carrying the reason", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		if (isMobile) await pressAndHold(page, trackRow(page, 0));
		else await trackRow(page, 0).click({ button: "right" });

		const item = page.getByRole("menuitem", { name: /^Add to queue/ });
		await expect(item).toBeVisible();
		await expect(item).toBeDisabled();
		await expect(item).toHaveAccessibleName(REASON);
	});

	test("the queue keeps each entry's remove and reorder and its Clear, disabled with the reason", async ({
		page,
		player,
		isMobile,
	}) => {
		const library = player.playlists.find((entry) => entry.id === "p7");
		if (!library) throw new Error("no p7 in the fixture");
		player.queueInsert([
			{ playlistId: "p7", track: library.items[0] },
			{ playlistId: "p7", track: library.items[1] },
		]);

		await openLibrary(page);
		await openQueue(page);
		const panel = queuePanel(page);
		await expect(panel.getByRole("listitem")).toHaveCount(2);

		for (const control of [
			button(panel, /^Remove .* from the queue/).first(),
			button(panel, /^Clear\b/),
		])
			await expectDisabledWithReason(control);

		if (isMobile) {
			// The grip is a drag handle and never took focus, so only the state and
			// the name are asked of it.
			const grip = button(panel, /^Reorder\b/).first();
			await expect(grip).toBeVisible();
			await expect(grip).toHaveAttribute("aria-disabled", "true");
			await expect(grip).toHaveAccessibleName(REASON);
		} else {
			// A mouse reorders by dragging the row itself; there is no grip to ask.
			const order = () =>
				player.queuedEntries().map((entry) => String(entry.track["%title%"]));
			const before = order();
			const rows = panel.getByRole("listitem");
			const from = (await rows.nth(1).boundingBox())!;
			const to = (await rows.nth(0).boundingBox())!;
			await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
			await page.mouse.down();
			await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, {
				steps: 12,
			});
			await page.mouse.up();

			await expectNothingRefusedSent(player);
			expect(order()).toEqual(before);
		}
	});

	test("a track dragged onto the queue button is refused with the reason, and nothing is queued", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");

		await openLibrary(page);
		await dragFrom(page, trackRow(page, 0), queueButton(page));
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await expect(queueButton(page)).toHaveAttribute(
			"data-drop-refuses",
			REASON,
		);
		await page.mouse.up();

		await expectNothingRefusedSent(player);
		expect(player.playQueue).toHaveLength(0);
	});

	test("activating a row plays nothing and sends nothing the player would refuse", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);

		if (isMobile) await trackRow(page, 2).tap();
		else {
			await trackRow(page, 2).dblclick();
			await trackRow(page, 4).click();
			await page.keyboard.press("Enter");
		}

		await expectNothingRefusedSent(player);
	});

	test("no playback key binding sends anything the player would refuse", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");

		await playingAtThePlayer(page, player);

		// Pressed from the body: Space on a focused button presses the button.
		for (const key of [
			"Space",
			"ControlOrMeta+ArrowRight",
			"ControlOrMeta+ArrowLeft",
			"ControlOrMeta+.",
			"ArrowRight",
			"ArrowLeft",
			"=",
			"-",
			"m",
		])
			await page.keyboard.press(key);

		await trackRow(page, 4).click();
		await page.keyboard.press("s");

		await expectNothingRefusedSent(player);
	});
});
