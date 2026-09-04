import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	statusBar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";

// The lyric tag is `$meta(unsynced lyrics)` and the name lies: it holds LRC
// timestamps about a third of the time.

const LYRIC = {
	// Repeated timestamps on one line: a refrain sung twice.
	synced: [
		"[00:12.00]I never meant to",
		"[00:18.50][01:02.10]Give you all my time",
		"[00:24.00]Dancing in the dark",
		"[00:31.00]",
		"[01:20.00]And I don't mind",
	].join("\r\n"),

	plain: ["Wait a minute, let me finish", "", "I came committed"].join("\r\n"),

	// A NetEase rip of an instrumental: two credit lines and a marker, all inside
	// the first five seconds of a four-minute track.
	boilerplate: [
		"[00:00.00] 作词 : Marcus Fuereder",
		"[00:01.00] 作曲 : Marcus Fuereder",
		"[00:05.00]纯音乐，请欣赏",
	].join("\r\n"),
};

const TOKEN = "0123456789abcdef0123456789abcdef";

const listenHere = async (page: Page) => {
	await page
		.locator("footer")
		.getByRole("button", {
			name: /Choose where to play|Playing on this device/,
		})
		.click();
	await page.getByRole("button", { name: /This device/ }).click();
	// `listeningPosition` answers null until audio is rendering.
	await page.waitForFunction(
		() => {
			const audio = document.querySelector("audio");
			return Boolean(audio && audio.currentTime > 0);
		},
		undefined,
		{ timeout: 60_000 },
	);
};

const TAGGED = {
	retagged: {
		"Los Calientes": { "$meta(unsynced lyrics)": LYRIC.synced },
		Fizz: { "$meta(unsynced lyrics)": LYRIC.plain },
		Deléctrico: { "$meta(unsynced lyrics)": LYRIC.boilerplate },
		// Soy Rock is left with no lyric tag at all -- the common case, at about
		// three quarters of a real library.
	},
};

const playRow = async (page: Page, row: number) => {
	await openLibrary(page);
	await trackRow(page, row).dblclick();
	await openNowPlaying(page);
};

const tab = (page: Page, name: string) =>
	nowPlayingScreen(page).getByRole("button", { name, exact: true });

test.describe("reading the lyric tag", () => {
	test.use(TAGGED);

	test("a timed lyric is followable, and every line is a seek target", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();

		const line = nowPlayingScreen(page).getByRole("button", {
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

	test("one line with two timestamps is two lines", async ({ page }) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();

		await expect(
			nowPlayingScreen(page).getByRole("button", {
				name: "Give you all my time",
			}),
		).toHaveCount(2);
	});

	test("an untimed lyric says so rather than looking like broken sync", async ({
		page,
	}) => {
		await playRow(page, 1);
		await tab(page, "Lyrics").click();

		await expect(nowPlayingScreen(page)).toContainText("Unsynced");
		await expect(nowPlayingScreen(page)).toContainText(
			"Wait a minute, let me finish",
		);
		// Not seekable, because there is nothing to seek to.
		await expect(
			nowPlayingScreen(page).getByRole("button", {
				name: "Wait a minute, let me finish",
			}),
		).toHaveCount(0);
	});

	test("timestamps that never leave the opening bars are not sync", async ({
		page,
	}) => {
		await playRow(page, 2);
		await tab(page, "Lyrics").click();

		// Three timestamps, so a count threshold would call this synced; they span
		// five seconds of a four-minute track.
		await expect(nowPlayingScreen(page)).toContainText("Unsynced");
		await expect(nowPlayingScreen(page)).toContainText("纯音乐，请欣赏");
		await expect(nowPlayingScreen(page)).not.toContainText("[00:00.00]");
	});

	test("no tag is a state rather than an explanation", async ({ page }) => {
		await playRow(page, 3);
		await tab(page, "Lyrics").click();

		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(nowPlayingScreen(page)).not.toContainText("foo_openlyrics");
	});
});

test.describe("a lyric read through the stream", () => {
	// Kept out of `TAGGED`: a component also makes the rating control writable,
	// which changes the screen the slim-strip tests measure. Six seconds of lag;
	// the default leaves none. See `test/README.md`.
	test.use({ ...TAGGED, fooJean: { streamPrime: 6 }, fooJeanToken: TOKEN });
	test.setTimeout(120_000);

	// Past the last line for the player, still on the refrain for the ear. The
	// two are eighteen seconds apart, so any lag up to that lands on the same
	// line.
	const PAST_THE_END = 80.5;

	test("follows the player when nothing is listening", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		player.patchPlayer({ position: PAST_THE_END });

		await openNowPlaying(page);
		await tab(page, "Lyrics").click();
		await expect(
			nowPlayingScreen(page).locator('[data-state="active"]'),
		).toHaveText("And I don't mind");
	});

	test("a line clicked while listening lands when the audio does", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);

		await openNowPlaying(page);
		await tab(page, "Lyrics").click();
		const active = nowPlayingScreen(page).locator('[data-state="active"]');

		// Played to, not seeked to: this is the setup.
		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		// Backwards is the case that matters: a position counting on from a stale
		// mark reaches any later line by simply playing, so a forward seek passes
		// either way.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "I never meant to" })
			.click();

		// The component marks a seek as it marks a track change, so the timeline
		// says where the stream jumped to.
		await expect(active).toHaveText("I never meant to", { timeout: 60_000 });
	});

	test("a clicked line answers at once, before the audio reaches it", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);

		await openNowPlaying(page);
		await tab(page, "Lyrics").click();
		const active = nowPlayingScreen(page).locator('[data-state="active"]');
		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		await nowPlayingScreen(page)
			.getByRole("button", { name: "I never meant to" })
			.click();

		// Well inside the fake's six-second lag: the audio has not arrived and the
		// control still has to hold where it was put.
		await expect(active).toHaveText("I never meant to", { timeout: 2500 });
	});
});

test.describe("which panel opens", () => {
	test.use(TAGGED);

	test("the gatefold opens on Details when the track has no lyrics", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the compact layout opens on the artwork instead");

		await playRow(page, 3);
		await expect(tab(page, "Details")).toHaveAttribute("data-active", "true");

		await playRow(page, 0);
		await expect(tab(page, "Lyrics")).toHaveAttribute("data-active", "true");
	});
});

test.describe("the details panel", () => {
	test.use({
		retagged: { "Los Calientes": { "%publisher%": "Discos Manzana" } },
	});

	test("lists what this file has and drops what it does not", async ({
		page,
	}) => {
		await playRow(page, 0);
		await tab(page, "Details").click();

		const panel = nowPlayingScreen(page);
		await expect(panel).toContainText("Publisher");
		await expect(panel).toContainText("Discos Manzana");

		// The fake resolves nothing for these, as a real player answers `?` for a
		// tag the file does not carry.
		await expect(panel).not.toContainText("BPM");
		await expect(panel).not.toContainText("ReplayGain");
	});
});

test.describe("the way in and the way out", () => {
	test("the status bar block opens it and the chevron closes it", async ({
		page,
	}) => {
		await openLibrary(page);

		await statusBar(page)
			.getByRole("button", { name: "Show current track" })
			.click();
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("a reload lands on it and leaving still goes somewhere", async ({
		page,
	}) => {
		// `history.back()` would leave Jean altogether here: a direct load has no
		// entry behind it.
		await page.goto("/#/playing");
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(page.locator("main")).toBeVisible();
	});
});

test.describe("the set it is playing from", () => {
	test("the header takes you back to it, and closes on the way", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Playing from/ })
			.click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test("it is a line and not a button when the set has nowhere to open", async ({
		page,
	}) => {
		// A playlist the user is playing straight from is not a set Jean
		// materialised, so the header says "Now playing" and offers nothing.
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		const header = nowPlayingScreen(page).locator("header");
		await expect(header).toContainText("Now playing");
		await expect(
			header.getByRole("button", { name: /Playing from/ }),
		).toHaveCount(0);
	});
});

test.describe("the screen a phone gets", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold is a pane inside the shell, which is the point of it",
	);

	test("is the whole viewport, the app chrome included", async ({ page }) => {
		await openLibrary(page);
		await openNowPlaying(page);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const view = page.viewportSize()!;
		expect(box.y, "the screen starts below the top bar").toBe(0);
		expect(box.height).toBeGreaterThanOrEqual(view.height);
	});

	test("Play is in the middle of the row, whatever flanks it", async ({
		page,
	}) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		const play = (await screen
			.getByRole("button", { name: /^(Play|Pause)$/ })
			.boundingBox())!;
		// The screen's padding is symmetrical, so the middle of the row is the
		// middle of the viewport.
		const view = page.viewportSize()!;
		const centre = play.x + play.width / 2;
		expect(
			Math.abs(centre - view.width / 2),
			`Play is centred at ${Math.round(centre)}px of ${view.width}px`,
		).toBeLessThanOrEqual(1);
	});
});

// The screen's own transport holds two controls that follow a finger, and both
// sit inside the surface the dismiss and tab gestures are read from.
test.describe("a control that follows the finger keeps the gesture", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the transport is compact-only, and this is touch",
	);

	test("the fader can be dragged down without dismissing the screen", async ({
		page,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await screen.getByRole("button", { name: "Show volume" }).click();
		const fader = page.getByRole("slider", { name: /Volume/ });
		const box = (await fader.boundingBox())!;
		const x = box.x + box.width / 2;

		// Well past the 60px a flick has to travel, downwards, which is the
		// gesture that dismisses the screen everywhere else on it.
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.15 },
			{ x, y: box.y + box.height * 0.85 },
		);

		// The hash rather than the element: dismissing navigates at once but takes
		// the length of the exit animation to leave the screen, so a visible
		// screen alone would pass with the dismissal already in flight.
		await expect(page).toHaveURL(/#\/playing$/);
		await expect(screen).toBeVisible();

		const landed = Number(await fader.getAttribute("aria-valuenow"));
		expect(landed, `fader landed at ${landed}%, aimed at 15%`).toBeLessThan(40);
	});

	test("the seek bar can be scrubbed without stepping the tabs", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);
		await expect(tab(page, "Playing")).toHaveAttribute("aria-current", "true");

		const bar = screen.getByRole("slider", { name: "Playback position" });
		const box = (await bar.boundingBox())!;
		const y = box.y + box.height / 2;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.75, y },
			{ x: box.x + box.width * 0.2, y },
		);

		await expect(tab(page, "Playing")).toHaveAttribute("aria-current", "true");
		// The scrub itself still landed: the gesture belongs to the bar, not to
		// nobody.
		await expect
			.poll(() =>
				requestsTo(player, "/api/player").filter(
					(entry) => entry.body?.position !== undefined,
				),
			)
			.toHaveLength(1);
	});
});

test.describe("the slim strip", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold's identity is a column of its own and takes space from nothing",
	);

	test("the Playing tab keeps the album, the year and the stars", async ({
		page,
	}) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		await expect(screen).toContainText("Los Calientes");
		await expect(screen).toContainText("Babasónicos");
		await expect(screen).toContainText("Jessico");
		await expect(
			screen.getByRole("img", { name: /stars|Unrated/ }),
		).toBeVisible();
	});

	test("the other tabs keep the title and the artist and drop the rest", async ({
		page,
	}) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();

		const screen = nowPlayingScreen(page);
		await expect(screen).toContainText("Los Calientes");
		await expect(screen).toContainText("Babasónicos");
		await expect(screen).not.toContainText("Jessico");
		await expect(
			screen.getByRole("img", { name: /stars|Unrated/ }),
		).toHaveCount(0);
		await expect(
			screen.getByRole("group", { name: /stars|Unrated/ }),
		).toHaveCount(0);
	});

	test("going back to Playing brings them back", async ({ page }) => {
		await playRow(page, 0);
		// Lyrics rather than Details, which lists the album in its own grid.
		await tab(page, "Lyrics").click();
		await expect(nowPlayingScreen(page)).not.toContainText("Jessico");

		await tab(page, "Playing").click();
		await expect(nowPlayingScreen(page)).toContainText("Jessico");
	});
});

// The slim strip's title is set `nowrap`, so a long one is as wide as its
// content whatever the window is. 480 sits between the phone at 412 and the
// gatefold at 861 -- the only width where the strip and a shrinking window are
// on screen together, and neither project otherwise runs there.
test.describe("a title wider than the screen", () => {
	test.use({
		viewport: { width: 480, height: 900 },
		retagged: {
			"Los Calientes": {
				"%title%":
					"Good to Know That If I Ever Need Attention All I Have to Do Is Die",
			},
		},
	});

	test("is truncated, and takes nothing else off the screen with it", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);
		await tab(page, "Details").click();

		const screen = nowPlayingScreen(page);
		const title = screen.getByRole("heading", { level: 1 });

		// The title really is longer than its box, so what follows is a claim about
		// a truncation that happened rather than about a short string.
		await expect
			.poll(() =>
				title.evaluate(
					(element: HTMLElement) => element.scrollWidth - element.clientWidth,
				),
			)
			.toBeGreaterThan(0);

		const box = await screen.boundingBox();
		const edge = (box?.x ?? 0) + (box?.width ?? 0);
		for (const inside of [title, tab(page, "Details")]) {
			const at = await inside.boundingBox();
			expect(
				(at?.x ?? 0) + (at?.width ?? 0),
				`${await inside.textContent()} runs past the right edge`,
			).toBeLessThanOrEqual(edge + 1);
		}
	});
});

// This layer is `position: fixed`; every other one in Jean is not.
test.describe("full-screen lyrics", () => {
	test.use(TAGGED);

	const expand = (page: Page) =>
		page.getByRole("button", { name: "Full-screen lyrics" });
	const close = (page: Page) =>
		page.getByRole("button", { name: "Close full-screen lyrics" });

	test("it is offered on the Lyrics tab and nowhere else", async ({ page }) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();
		await expect(expand(page)).toBeVisible();

		await tab(page, "Details").click();
		await expect(expand(page)).toHaveCount(0);
	});

	test("it is not offered when there is no lyric to expand", async ({
		page,
	}) => {
		await playRow(page, 3);
		await tab(page, "Lyrics").click();
		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(expand(page)).toHaveCount(0);
	});

	test("only the lyrics are left, and the X brings the screen back", async ({
		page,
	}) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();
		await expand(page).click();

		// Scoped to the full-screen region: the panel behind it does not hold a
		// second copy of the lyric.
		const full = page.getByRole("region", { name: "Lyrics" });
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
		await expect(tab(page, "Details")).toBeVisible();
	});

	test("Escape closes it, and closes only it", async ({ page }) => {
		await playRow(page, 0);
		await tab(page, "Lyrics").click();
		await expand(page).click();
		await expect(close(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(close(page)).toHaveCount(0);
		await expect(nowPlayingScreen(page)).toBeVisible();
	});
});
