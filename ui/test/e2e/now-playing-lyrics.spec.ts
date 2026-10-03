import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
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
	times,
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

interface PlayingRead {
	sentAt: number;
	answeredAt?: number;
	columns: number;
}

const recordPlayingReads = (page: Page) =>
	page.addInitScript(() => {
		const reads: { sentAt: number; answeredAt?: number; columns: number }[] =
			[];
		Object.assign(window, { playingReads: reads });
		const send = window.fetch.bind(window);
		window.fetch = (input, init) => {
			const asked = new URL(
				input instanceof Request ? input.url : String(input),
				location.href,
			);
			if (asked.pathname !== "/api/track/playing") return send(input, init);
			const read: { sentAt: number; answeredAt?: number; columns: number } = {
				sentAt: Date.now(),
				columns: asked.searchParams.getAll("columns").length,
			};
			reads.push(read);
			return send(input, init).then((response) => {
				read.answeredAt = Date.now();
				return response;
			});
		};
	});

const playingReads = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { playingReads: PlayingRead[] }).playingReads,
	);

const firstReadAnswered = async (page: Page) => {
	await expect
		.poll(async () => (await playingReads(page))[0]?.answeredAt)
		.toBeDefined();
	return (await playingReads(page))[0].answeredAt as number;
};

const looksAt = async (page: Page) => {
	const [first, ...looks] = await playingReads(page);
	return looks.map((look) =>
		Math.floor((look.sentAt - (first.answeredAt as number)) / 1_000),
	);
};

const recheckColumnCounts = (player: FakePlayer) =>
	requestsTo(player, "/api/track/playing")
		.filter((entry) => entry.method === "GET")
		.slice(1)
		.map(
			(entry) =>
				new URLSearchParams(entry.path.split("?")[1] ?? "").getAll("columns")
					.length,
		);

// The panel's view switcher marks its own tab current as well.
const currentLine = (panel: Locator) =>
	panel.locator('[aria-current="true"]:not(nav *)');

// See "A fake clock advances honestly only in small steps" in test/README.md.
const CLOCK_STEP_MS = 250;

const runClockTo = async (page: Page, until: number) => {
	const from = await page.evaluate(() => Date.now());
	await times(Math.ceil((until - from) / CLOCK_STEP_MS), () =>
		page.clock.runFor(CLOCK_STEP_MS),
	);
};

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
				requestsTo(player, "/api/playback/seek").flatMap((entry) =>
					entry.body && "seconds" in entry.body ? [entry.body.seconds] : [],
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
		await page.clock.install();
		await recordPlayingReads(page);
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		const from = await firstReadAnswered(page);
		await runClockTo(page, from + 6_000);
		writeLyric(player, "Searched for, and found");
		await runClockTo(page, from + 30_000);

		await expect(panel).toContainText("Searched for, and found");
		expect(await looksAt(page)).toEqual([2, 5, 10]);
		expect(recheckColumnCounts(player)).toEqual([1, 1, 1]);
	});

	test("a lyric that never arrives is looked for four times and then left alone", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await recordPlayingReads(page);
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		const from = await firstReadAnswered(page);
		await runClockTo(page, from + 45_000);

		expect(await looksAt(page)).toEqual([2, 5, 10, 20]);
		expect(recheckColumnCounts(player)).toEqual([1, 1, 1, 1]);
		await expect(panel).toContainText("No lyrics found");
	});

	// A station announcing a song keeps the path, so it is not a track change:
	// the looks keep the schedule they started at the track's own read.
	test("a song a station announces neither restarts the looks nor ends them", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await recordPlayingReads(page);
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		const from = await firstReadAnswered(page);
		await runClockTo(page, from + 3_000);
		player.announceSong({ title: "Ocean Floor", artist: "Gravity Wave" });
		await runClockTo(page, from + 45_000);

		const [, ...after] = await playingReads(page);
		const secondsIn = (read: PlayingRead) =>
			Math.floor((read.sentAt - from) / 1_000);
		expect(
			after.filter((read) => read.columns > 1).map(secondsIn),
			"the announcement's own read of the song",
		).toHaveLength(1);
		expect(after.filter((read) => read.columns === 1).map(secondsIn)).toEqual([
			2, 5, 10, 20,
		]);
	});

	// A look still scheduled for the track that was left would ask the player
	// about whatever is playing now, which is some other track entirely.
	test("a track change ends the looks for the track it left", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await recordPlayingReads(page);
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		const from = await firstReadAnswered(page);
		await runClockTo(page, from + 3_000);
		expect(await looksAt(page)).toEqual([2]);

		// Pendejo, which carries a lyric, so nothing after the change has a
		// reason of its own to look again.
		player.next();
		await expect(panel).toContainText("Line 1");
		const readsAtChange = (await playingReads(page)).length;

		await runClockTo(page, from + 30_000);
		expect(await playingReads(page)).toHaveLength(readsAtChange);
	});
});

// foo_openlyrics reads `UNSYNCED LYRICS`, `LYRICS`, `SYNCEDLYRICS` and `UNSYNCEDLYRICS`, in that
// order.
test.describe("the lyric tags foo_openlyrics reads", () => {
	const synced = (words: string) =>
		[
			`[00:12.00]${words}, the first line`,
			`[00:40.00]${words}, the second line`,
			`[01:20.00]${words}, the last line`,
		].join("\r\n");

	const plain = (words: string) =>
		[`${words}, untimed`, "", `${words}, still untimed`].join("\r\n");

	const TAG_ORDER: {
		state: string;
		row: number;
		tags: Record<string, string>;
		shows: string;
	}[] = [
		{
			state: "UNSYNCED LYRICS over LYRICS",
			row: 1,
			tags: {
				"unsynced lyrics": plain("From UNSYNCED LYRICS"),
				lyrics: plain("From LYRICS"),
			},
			shows: "From UNSYNCED LYRICS",
		},
		{
			state: "LYRICS over SYNCEDLYRICS and UNSYNCEDLYRICS",
			row: 2,
			tags: {
				lyrics: plain("From LYRICS"),
				syncedlyrics: plain("From SYNCEDLYRICS"),
				unsyncedlyrics: plain("From UNSYNCEDLYRICS"),
			},
			shows: "From LYRICS",
		},
		{
			state: "SYNCEDLYRICS over UNSYNCEDLYRICS",
			row: 4,
			tags: {
				syncedlyrics: plain("From SYNCEDLYRICS"),
				unsyncedlyrics: plain("From UNSYNCEDLYRICS"),
			},
			shows: "From SYNCEDLYRICS",
		},
		{
			state: "UNSYNCEDLYRICS when it is the only one",
			row: 5,
			tags: { unsyncedlyrics: plain("From UNSYNCEDLYRICS") },
			shows: "From UNSYNCEDLYRICS",
		},
	];

	const ROW_TITLES = [
		"Los Calientes",
		"Fizz",
		"Deléctrico",
		"Soy Rock",
		"Pendejo",
		"El Loco",
	];

	const asTags = (tags: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(tags).map(([tag, lyric]) => [`$meta(${tag})`, lyric]),
		);

	test.use({
		retagged: {
			[ROW_TITLES[0]]: asTags({ lyrics: synced("From LYRICS") }),
			...Object.fromEntries(
				TAG_ORDER.map(({ row, tags }) => [ROW_TITLES[row], asTags(tags)]),
			),
		},
	});

	test("a LYRICS tag alone is shown, and shown synced", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();

		await expect(
			panel.getByRole("button", { name: "From LYRICS, the second line" }),
		).toBeVisible();
		await expect(panel).not.toContainText("Unsynced");
	});

	for (const { state, row, tags, shows } of TAG_ORDER) {
		test(`the panel shows ${state}`, async ({ page, isMobile }) => {
			await playRow(page, row);
			const panel = await openPanels(page, isMobile);
			await panelTab(panel, "Lyrics").click();

			await expect(panel).toContainText(`${shows}, untimed`);
			for (const lyric of Object.values(tags)) {
				const [first] = lyric.split("\r\n");
				if (first !== `${shows}, untimed`)
					await expect(panel).not.toContainText(first);
			}
		});
	}

	test("a LYRICS tag written mid-track arrives through the re-read, which asks what the screen asked", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await recordPlayingReads(page);
		await playRow(page, 3);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("No lyrics found");

		const from = await firstReadAnswered(page);
		await runClockTo(page, from + 6_000);
		writeLyric(player, synced("Written mid-track"), "lyrics");
		await runClockTo(page, from + 30_000);

		await expect(
			panel.getByRole("button", { name: "Written mid-track, the last line" }),
		).toBeVisible();
		expect(await looksAt(page)).toEqual([2, 5, 10]);

		const asked = requestsTo(player, "/api/track/playing")
			.filter((entry) => entry.method === "GET")
			.map((entry) =>
				new URLSearchParams(entry.path.split("?")[1] ?? "").getAll("columns"),
			);
		const screenAsked = asked.filter((columns) => columns.length > 1).flat();
		const reReads = asked.filter((columns) => columns.length === 1).flat();
		expect(reReads).toHaveLength(3);
		for (const expression of reReads) expect(screenAsked).toContain(expression);
	});
});

test.describe("a lyric read through the stream", () => {
	// Kept out of `TAGGED`: a component also makes the rating control writable,
	// which changes the screen the slim-strip tests measure. Six seconds of lag;
	// the default leaves none. See `test/README.md`.
	test.use({
		...TAGGED,
		fooJean: { streamPrime: 6 },
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
		await expect(currentLine(panel)).toHaveText("And I don't mind");
	});

	test("a clicked line answers at once, before the audio reaches it", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");
		// Started at the line the click goes back to, so the wait below is the
		// lag and one line rather than the whole opening of the track.
		player.patchPlayer({ position: 12 });
		await listenHere(page);

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		const active = currentLine(panel);

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

	test("the arrows still seek underneath it, and F closes it again", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await pressF(page);
		await expect(fullScreen(page)).toBeVisible();

		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");
		await expect
			.poll(() =>
				requestsTo(player, "/api/playback/seek").map((entry) => entry.body),
			)
			.toEqual([{ relativeSeconds: 5 }, { relativeSeconds: -5 }]);

		await page.keyboard.press("f");
		await expect(fullScreen(page)).toHaveCount(0);
	});

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
