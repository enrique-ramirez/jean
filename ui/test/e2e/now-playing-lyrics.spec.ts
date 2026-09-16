import type { Page } from "./fixtures.ts";
import {
	expect,
	FOO_JEAN_TOKEN,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	requestsTo,
	sidebar,
	sidebarToggle,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";
import {
	expectPanelOpen,
	openPanels,
	panelTab,
	playRow,
	TAGGED,
	writeLyric,
} from "./nowPlaying.ts";

test.describe("reading the lyric tag", () => {
	test.use(TAGGED);

	test("a timed lyric is followable, and every line is a seek target", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		const line = panel.getByRole("button", {
			name: "Dancing in the dark",
		});
		await expect(line).toBeVisible();

		await line.click();
		await expect
			.poll(() =>
				requestsTo(player, "/api/player").flatMap((entry) =>
					entry.body && "position" in entry.body ? [entry.body.position] : [],
				),
			)
			.toContain(24);
	});

	test("one line with two timestamps is two lines", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(
			panel.getByRole("button", { name: "Give you all my time" }),
		).toHaveCount(2);
	});

	test("an untimed lyric says so rather than looking like broken sync", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 1);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(panel).toContainText("Unsynced");
		await expect(panel).toContainText("Wait a minute, let me finish");
		await expect(
			panel.getByRole("button", { name: "Wait a minute, let me finish" }),
		).toHaveCount(0);
	});

	test("timestamps that never leave the opening bars are not sync", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 2);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		// Three timestamps, so a count threshold would call this synced; they span
		// five seconds of a four-minute track.
		await expect(panel).toContainText("Unsynced");
		await expect(panel).toContainText("纯音乐，请欣赏");
		await expect(panel).not.toContainText("[00:00.00]");
	});

	test("no tag is a state rather than an explanation", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(panel).toContainText("No lyrics found");
		await expect(panel).not.toContainText("foo_openlyrics");
	});

	// The reason the panel looks again at all: a search that lands after the track
	// started would otherwise show nothing until the next time it is played.
	test("a lyric written mid-track arrives without a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		writeLyric(player, "Searched for, and found");

		await expect(panel).toContainText("Searched for, and found", {
			timeout: 15_000,
		});
	});
});

test.describe("a lyric read through the stream", () => {
	// Kept out of `TAGGED`: a component also makes the rating control writable,
	// which changes the screen the slim-strip tests measure. Six seconds of lag;
	// the default leaves none. See `test/README.md`.
	test.use({
		...TAGGED,
		fooJean: { streamPrime: 6 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});
	test.setTimeout(120_000);

	// Past the last line for the player, still on the refrain for the ear. The
	// two are eighteen seconds apart, so any lag up to that lands on the same
	// line.
	const PAST_THE_END = 80.5;

	test("follows the player when nothing is listening", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		player.patchPlayer({ position: PAST_THE_END });

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel.locator('[data-state="active"]')).toHaveText(
			"And I don't mind",
		);
	});

	test("a clicked line answers at once, before the audio reaches it", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		const active = panel.locator('[data-state="active"]');

		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		// Backwards is the case that matters: a position counting on from a stale
		// mark reaches any later line by simply playing, so a forward seek passes
		// either way. The component marks a seek as it marks a track change, so
		// the timeline says where the stream jumped to.
		await panel.getByRole("button", { name: "I never meant to" }).click();

		// Well inside the fake's six-second lag: the audio has not arrived and the
		// control still has to hold where it was put.
		await expect(active).toHaveText("I never meant to", { timeout: 2500 });
	});
});

test.describe("full-screen lyrics", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => isMobile,
		"a phone's Lyrics layer is already full screen, so there is nothing to expand",
	);

	const expand = (page: Page) =>
		page.getByRole("button", { name: "Full-screen lyrics" });
	const close = (page: Page) =>
		page.getByRole("button", { name: "Close full-screen lyrics" });
	const fullScreen = (page: Page) =>
		page.getByRole("region", { name: "Lyrics" });

	// The expand control is what says the track's details have arrived, and `F`
	// answers the same condition it does. A press that lands before them is
	// delivered, dropped, and never repeated, so every press meant to open the
	// screen goes through here.
	const pressF = async (page: Page) => {
		await expect(expand(page)).toBeVisible();
		await page.keyboard.press("f");
	};

	test("it is offered on the Lyrics tab and nowhere else", async ({ page }) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);
		await panelTab(panel, "Lyrics").click();
		await expect(expand(page)).toBeVisible();

		await panelTab(panel, "Details").click();
		await expect(expand(page)).toHaveCount(0);
	});

	test("it is not offered when there is no lyric to expand", async ({
		page,
	}) => {
		await playRow(page, 3);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(expand(page)).toHaveCount(0);
	});

	// The three cases where `F` must do nothing, the Details tab, the Artist tab
	// and a track with no lyric, are tests of their own rather than tails on this
	// one. This is the case a builder writes and reads as done; the failure that
	// bites is the other direction, `F` live where the expand control is not
	// drawn, opening a full screen of nothing.
	test("F opens the full screen with the Lyrics tab open and a lyric to show", async ({
		page,
	}) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expect(fullScreen(page)).toHaveCount(0);

		await pressF(page);

		await expect(fullScreen(page)).toBeVisible();
		await expect(close(page)).toBeVisible();
	});

	// `F` and the expand control answer one condition: the Lyrics tab open, with a
	// lyric to show. These are its terms failing one at a time, a case each rather
	// than three presses in one, so a red one names the term that stopped holding.
	// Each gives up its one term from a state where the other two hold, or the
	// press would do nothing for a reason the case is not about.
	//
	// Each then reaches the state where `F` is meant to work and presses it again.
	// Without that second press a case would pass just as well for a keystroke
	// that never arrived at the app at all.
	const NOTHING_TO_EXPAND: {
		state: string;
		reach: (page: Page) => Promise<void>;
		satisfy: (page: Page) => Promise<void>;
	}[] = [
		{
			state: "with the Details tab open",
			reach: async (page) => {
				await playRow(page, 0);
				await panelTab(nowPlayingScreen(page), "Lyrics").click();
				await expect(expand(page)).toBeVisible();
				await panelTab(nowPlayingScreen(page), "Details").click();
				await expectPanelOpen(nowPlayingScreen(page), "Details");
			},
			satisfy: (page) => panelTab(nowPlayingScreen(page), "Lyrics").click(),
		},
		{
			state: "with the Artist tab open",
			reach: async (page) => {
				await playRow(page, 0);
				await panelTab(nowPlayingScreen(page), "Lyrics").click();
				await expect(expand(page)).toBeVisible();
				await panelTab(nowPlayingScreen(page), "Artist").click();
				await expectPanelOpen(nowPlayingScreen(page), "Artist");
			},
			satisfy: (page) => panelTab(nowPlayingScreen(page), "Lyrics").click(),
		},
		{
			state: "on a track with no lyric",
			reach: async (page) => {
				await playRow(page, 3);
				await panelTab(nowPlayingScreen(page), "Lyrics").click();
				await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
			},
			satisfy: async (page) => {
				// Out of the screen and wait for it to go, before playing anything
				// else: `playRow` opens the screen only where there is not one
				// already, and one still sliding out answers that there is.
				await nowPlayingScreen(page)
					.getByRole("button", { name: "Close now playing" })
					.click();
				await expect(nowPlayingScreen(page)).toHaveCount(0);

				await playRow(page, 0);
				await panelTab(nowPlayingScreen(page), "Lyrics").click();
			},
		},
	];

	for (const { state, reach, satisfy } of NOTHING_TO_EXPAND) {
		test(`F opens nothing ${state}`, async ({ page }) => {
			await reach(page);

			await page.keyboard.press("f");
			await expect(fullScreen(page)).toHaveCount(0);

			await satisfy(page);
			await pressF(page);
			await expect(fullScreen(page)).toBeVisible();
		});
	}

	test("only the lyrics are left, and the X brings the screen back", async ({
		page,
	}) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expand(page).click();

		// Scoped to the full-screen region: the panel behind it does not hold a
		// second copy of the lyric.
		const full = fullScreen(page);
		await expect(
			full.getByRole("button", { name: "Dancing in the dark" }),
		).toBeVisible();
		await expect(
			nowPlayingScreen(page).getByRole("button", {
				name: "Dancing in the dark",
			}),
		).toHaveCount(0);
		// Everything else is covered rather than removed, so this is geometry
		// rather than visibility. Every other layer in Jean sits inside `.body`,
		// which starts below the top bar.
		const box = await full.boundingBox();
		const view = page.viewportSize();
		expect(box).toBeTruthy();
		expect(view).toBeTruthy();
		expect(box?.x).toBe(0);
		expect(box?.y).toBe(0);
		expect(box?.width).toBe(view?.width);
		expect(box?.height).toBe(view?.height);

		await close(page).click();
		await expect(close(page)).toHaveCount(0);
		await expect(panelTab(nowPlayingScreen(page), "Details")).toBeVisible();
	});

	const NOTHING_ELSE = "nothing but the lyric screen is on screen";

	const whatIsLeftOfTheApp = (page: Page) =>
		fullScreen(page).evaluate((node, clear) => {
			const box = node.getBoundingClientRect();
			const short = [
				box.left > 0 && `${Math.round(box.left)}px in from the left`,
				box.top > 0 && `${Math.round(box.top)}px down from the top`,
				box.right < window.innerWidth &&
					`${Math.round(window.innerWidth - box.right)}px short of the right`,
				box.bottom < window.innerHeight &&
					`${Math.round(window.innerHeight - box.bottom)}px short of the bottom`,
			].filter((edge): edge is string => edge !== false);
			if (short.length > 0) return `the lyric screen stops ${short.join(", ")}`;

			// A box says where a thing is drawn and not what is drawn over it, so
			// the chrome this is meant to cover is asked the way a finger asks.
			const chrome: [string, Element | null][] = [
				[
					"the sidebar icon",
					document.querySelector(
						'button[aria-label="Show playlists"], button[aria-label="Hide playlists"]',
					),
				],
				["the sidebar", document.querySelector('nav[aria-label="Playlists"]')],
			];
			for (const [name, element] of chrome) {
				const seat = element?.getBoundingClientRect();
				if (!seat || seat.width === 0 || seat.height === 0) continue;

				const hit = document.elementFromPoint(
					seat.left + seat.width / 2,
					seat.top + seat.height / 2,
				);
				if (hit && node.contains(hit)) continue;
				const over =
					hit?.closest("[aria-label]")?.getAttribute("aria-label") ??
					hit?.tagName.toLowerCase() ??
					"nothing";
				return `a press at the middle of ${name} lands on ${over}`;
			}
			return clear;
		}, NOTHING_ELSE);

	// A test that a full-screen thing is full screen, which is why it says here
	// what it is for rather than leaving a later reader to delete it as saying
	// nothing. The now-playing screen beside it went the other way: it took the
	// second grid column and gained `container-type: inline-size`, and a size
	// container is the containing block for every `position: fixed` box inside
	// it. The lyric screen escapes that only by being rendered as a sibling of
	// that screen rather than a child, `src/features/now-playing/CLAUDE.md`. So
	// what this catches is somebody making it a child, or a column placement
	// widening far enough to reach it.
	test("covers the viewport whole, the header and the sidebar with it, in both sidebar states", async ({
		page,
	}) => {
		await playRow(page, 0);
		await openSidebar(page);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();

		await expand(page).click();
		await expect
			.poll(() => whatIsLeftOfTheApp(page), { message: "sidebar shown" })
			.toBe(NOTHING_ELSE);

		// Out and back in, rather than hiding the sidebar from underneath: while
		// the lyric screen is up its toggle is covered, which is the whole claim.
		await close(page).click();
		await sidebarToggle(page).click();
		await expect(sidebar(page)).toBeHidden();

		await expand(page).click();
		await expect
			.poll(() => whatIsLeftOfTheApp(page), { message: "sidebar hidden" })
			.toBe(NOTHING_ELSE);
	});

	test("Escape closes it, and closes only it", async ({ page }) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await expand(page).click();
		await expect(close(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(close(page)).toHaveCount(0);
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	const queuePanel = (page: Page) =>
		page.getByRole("complementary", { name: "Queue" });

	// Closed, the panel is parked off the right edge rather than hidden, so it
	// answers `toBeVisible()` either way.
	const openTheQueue = async (page: Page) => {
		await statusBar(page)
			.getByRole("button", { name: /^Queue/ })
			.click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
	};

	// A test about the queue in a lyrics spec, and the one case that separates a
	// keyboard the lyric screen has claimed from a hand-written term suppressing
	// one layer at a time. `QueuePanel` gates its own Escape on nothing owning the
	// keyboard, so a lyric screen taking Escape without claiming leaves the queue
	// taking the same keystroke, and one press closes both.
	//
	// `F` is the only way in: with the queue open, the panel is docked over the
	// right of the screen and a press at the middle of the expand control lands on
	// the queue instead.
	test("Escape closes the lyric screen and leaves the queue open under it", async ({
		page,
	}) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await openTheQueue(page);

		await pressF(page);
		await expect(close(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(close(page)).toHaveCount(0);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		// The queue's Escape comes back the moment the claim is given up, which is
		// what says the first press was stood down rather than never bound.
		await page.keyboard.press("Escape");
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
		await expect(nowPlayingScreen(page)).toBeVisible();
	});
});
