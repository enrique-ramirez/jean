import { KEYMAP } from "../../src/shared/keyboard/keymap.ts";
import type { Locator, Page } from "./fixtures.ts";
import {
	expect,
	isRowOnScreen,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	scrollTo,
	scrollTop,
	scrollUntilMounted,
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

	// Long enough to scroll the panel on any phone, and untimed so nothing
	// follows it back up while a test is reading where it was left.
	long: Array.from({ length: 80 }, (_, at) => `Line ${at + 1}`).join("\r\n"),

	// The same, timed: long enough to scroll, and spread across the track so it
	// is followable rather than boilerplate.
	longSynced: Array.from({ length: 60 }, (_, at) => {
		const second = 4 + at * 4;
		const mm = String(Math.floor(second / 60)).padStart(2, "0");
		const ss = String(second % 60).padStart(2, "0");
		return `[${mm}:${ss}.00]Line ${at + 1} of the song`;
	}).join("\r\n"),

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
	await page.getByRole("button", { name: "Listen here" }).click();
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
		Pendejo: { "$meta(unsynced lyrics)": LYRIC.long },
		"El Loco": { "$meta(unsynced lyrics)": LYRIC.longSynced },
		// Soy Rock is left with no lyric tag at all -- the common case, at about
		// three quarters of a real library.
	},
};

const playRow = async (page: Page, row: number) => {
	await openLibrary(page);
	await trackRow(page, row).dblclick();
	await openNowPlaying(page);
};

// Where the three panels are, which is a question about the viewport rather
// than about the panels: the gatefold's right leaf, or the layer a phone opens
// from the Lyrics button. Everything that reads one goes through here rather
// than knowing which.
const trackInfo = (page: Page) =>
	page.getByRole("region", { name: "Track information" });

const openPanels = async (page: Page, isMobile: boolean) => {
	if (!isMobile) return nowPlayingScreen(page);
	await nowPlayingScreen(page).getByRole("button", { name: "Lyrics" }).click();
	await expect(trackInfo(page)).toBeVisible();
	return trackInfo(page);
};

const tab = (root: Locator, name: string) =>
	root.getByRole("button", { name, exact: true });

const wheel = (page: Page) =>
	nowPlayingScreen(page).locator("[data-cover-wheel]");

const turnOf = (page: Page) =>
	wheel(page).evaluate((el) => el.style.getPropertyValue("--turn"));

// With motion allowed the screen slides in, and a box measured mid-slide puts the whole gesture somewhere else.
const settled = (page: Page) =>
	nowPlayingScreen(page).evaluate(async (el) => {
		await Promise.all(el.getAnimations().map((entry) => entry.finished));
	});

const across = async (page: Page, from: number, to: number) => {
	await settled(page);
	const box = (await nowPlayingScreen(page).boundingBox())!;
	const y = box.y + box.height * 0.4;
	await touchDrag(
		page,
		{ x: box.x + box.width * from, y },
		{ x: box.x + box.width * to, y },
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
		await tab(panel, "Lyrics").click();

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
		await tab(panel, "Lyrics").click();

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
		await tab(panel, "Lyrics").click();

		await expect(panel).toContainText("Unsynced");
		await expect(panel).toContainText("Wait a minute, let me finish");
		// Not seekable, because there is nothing to seek to.
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
		await tab(panel, "Lyrics").click();

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
		await tab(panel, "Lyrics").click();

		await expect(panel).toContainText("No lyrics found");
		await expect(panel).not.toContainText("foo_openlyrics");
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
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		player.patchPlayer({ position: PAST_THE_END });

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await tab(panel, "Lyrics").click();
		await expect(panel.locator('[data-state="active"]')).toHaveText(
			"And I don't mind",
		);
	});

	test("a line clicked while listening lands when the audio does", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await tab(panel, "Lyrics").click();
		const active = panel.locator('[data-state="active"]');

		// Played to, not seeked to: this is the setup.
		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		// Backwards is the case that matters: a position counting on from a stale
		// mark reaches any later line by simply playing, so a forward seek passes
		// either way.
		await panel.getByRole("button", { name: "I never meant to" }).click();

		// The component marks a seek as it marks a track change, so the timeline
		// says where the stream jumped to.
		await expect(active).toHaveText("I never meant to", { timeout: 60_000 });
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
		await tab(panel, "Lyrics").click();
		const active = panel.locator('[data-state="active"]');
		await expect(active).toHaveText("Give you all my time", {
			timeout: 90_000,
		});

		await panel.getByRole("button", { name: "I never meant to" }).click();

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
		test.skip(
			isMobile,
			"a phone opens these by pressing Lyrics, which is the answer already",
		);

		await playRow(page, 3);
		const panel = nowPlayingScreen(page);
		await expect(tab(panel, "Details")).toHaveAttribute("data-active", "true");

		await playRow(page, 0);
		await expect(tab(panel, "Lyrics")).toHaveAttribute("data-active", "true");
	});
});

test.describe("opening a panel from the keyboard", () => {
	test.use(TAGGED);

	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("each tab answers to its own initial", async ({ page }) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);

		await page.keyboard.press("d");
		await expect(tab(panel, "Details")).toHaveAttribute("data-active", "true");

		await page.keyboard.press("a");
		await expect(tab(panel, "Artist")).toHaveAttribute("data-active", "true");

		await page.keyboard.press("l");
		await expect(tab(panel, "Lyrics")).toHaveAttribute("data-active", "true");
	});

	test("and the strip underlines the letter it answers to", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);

		// Read off the keymap rather than spelled out here: the hint and the
		// binding are one fact, and a letter that moved in only one of them is
		// exactly what this is for.
		for (const [id, label] of [
			["showLyrics", "Lyrics"],
			["showDetails", "Details"],
			["showArtist", "Artist"],
		]) {
			const binding = KEYMAP.find((entry) => entry.id === id);
			await expect(tab(panel, label).locator("span").first()).toHaveText(
				String(binding?.keys[0]),
			);
		}
	});
});

test.describe("the details panel", () => {
	test.use({
		retagged: { "Los Calientes": { "%publisher%": "Discos Manzana" } },
	});

	test("lists what this file has and drops what it does not", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await tab(panel, "Details").click();

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

	test("Escape closes it, and leaves a selection behind it alone", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await openLibrary(page);
		await trackRow(page, 1).click();
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");

		await openNowPlaying(page);
		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();

		// Escape also clears a selection in the list, which is why this one is
		// taken on the way down and stopped: two meanings, one keystroke.
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");
	});

	test("a field keeps Escape while the screen is open", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the top bar is behind the screen on a phone");

		await openLibrary(page);
		await openNowPlaying(page);

		// Empty rather than typed at: typing in this field is itself a navigation
		// to the search route, which closes the screen before Escape is pressed.
		const field = page.getByLabel("Search your library");
		await field.focus();
		await field.press("Escape");

		// Leaving a field is the same key, and the screen must not reach over a
		// caret to take it. The hash rather than the element, since dismissing
		// navigates at once but takes the exit animation to leave.
		await expect(field).not.toBeFocused();
		await expect(page).toHaveURL(/#\/playing$/);
	});

	test("the track menu takes Escape before the screen does", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await playRow(page, 0);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Track actions" })
			.click();
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
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

	// Following is off throughout, so nothing but the header can be moving the
	// view: on arrival the follow would centre the playing row by itself.
	test.describe("it lands on the track, not at the top of the set", () => {
		test.use({
			mediaLibrarySize: 400,
			librarySize: 400,
			settings: { "jean.followPlayback": false },
		});

		// Far enough down a 400-track library to be nowhere near the fold.
		const FAR = 120;

		const playFarAndLeaveTheTop = async (page: Page) => {
			await page.goto("/#/all");
			await expect(
				page.getByRole("heading", { level: 1, name: "All music" }),
			).toBeVisible();
			await scrollUntilMounted(page, trackRow(page, FAR));
			await trackRow(page, FAR).dblclick();
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");

			// The set is left at the top, so the offset it remembers is not the
			// track and arriving at it proves something.
			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);
		};

		const openThePlayingSet = async (page: Page) => {
			await openNowPlaying(page);
			await nowPlayingScreen(page)
				.getByRole("button", { name: /Playing from/ })
				.click();
			await expect(nowPlayingScreen(page)).toBeHidden();
		};

		test("from another view", async ({ page }) => {
			await playFarAndLeaveTheTop(page);
			await page.goto("/#/p5");
			await expect(page.getByRole("grid")).toBeVisible();

			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");
		});

		test("and from the set it is already showing", async ({ page }) => {
			await playFarAndLeaveTheTop(page);

			// Nothing to navigate to: the screen closes onto the list it was opened
			// over, and the row still has to be found.
			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
		});
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

	test("the seek bar can be scrubbed without skipping the track", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);
		const playing = player.player.activeItem.index;

		const bar = screen.getByRole("slider", { name: "Playback position" });
		const box = (await bar.boundingBox())!;
		const y = box.y + box.height / 2;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.75, y },
			{ x: box.x + box.width * 0.2, y },
		);

		expect(player.player.activeItem.index).toBe(playing);
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

// The phone's whole restructure in one describe: no tabs on the player, a
// button into the panels, and a horizontal flick that means the next track
// rather than the next tab.
test.describe("the panels a phone opens", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold keeps its tabs in a leaf beside the artwork",
	);

	test("the player carries no tabs at all", async ({ page }) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		await expect(
			screen.getByRole("navigation", { name: "Track views" }),
		).toHaveCount(0);
		await expect(screen.getByRole("button", { name: "Details" })).toHaveCount(
			0,
		);
		await expect(screen.getByRole("button", { name: "Artist" })).toHaveCount(0);
	});

	test("the Lyrics button opens them and the chevron closes them", async ({
		page,
	}) => {
		await playRow(page, 0);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Lyrics" })
			.click();

		const panel = trackInfo(page);
		await expect(panel).toBeVisible();
		await expect(tab(panel, "Lyrics")).toHaveAttribute("data-active", "true");
		await expect(panel).toContainText("Dancing in the dark");

		await panel
			.getByRole("button", { name: "Close track information" })
			.click();
		await expect(panel).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("it opens on Lyrics even when the file has none", async ({ page }) => {
		// The button names the tab it opens, and the empty state is where finding
		// a lyric will go. Falling through to Details is the gatefold's rule,
		// where the strip is the only way in.
		await playRow(page, 3);
		const panel = await openPanels(page, true);

		await expect(tab(panel, "Lyrics")).toHaveAttribute("data-active", "true");
		await expect(panel).toContainText("No lyrics found");
	});

	test("Escape closes them and leaves the screen up", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("a sideways flick inside them steps the tabs", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.boundingBox())!;
		const y = box.y + box.height * 0.6;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.8, y },
			{ x: box.x + box.width * 0.2, y },
		);

		await expect(tab(panel, "Details")).toHaveAttribute("data-active", "true");
	});

	test("a flick up closes them too", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.6 },
			{ x, y: box.y + box.height * 0.6 - 120 },
		);

		await expect(panel).toBeHidden();
	});

	test("but not while there is more lyric under it", async ({ page }) => {
		// Up is how you read on. It only means "done with this" once there is
		// nothing left below, which is the mirror of what down already does.
		await playRow(page, 4);
		const panel = await openPanels(page, true);

		const body = panel.locator('[data-tab="lyrics"]');
		await expect
			.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight + 1))
			.toBe(true);

		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		const flickUp = () =>
			touchDrag(
				page,
				{ x, y: box.y + box.height * 0.6 },
				{ x, y: box.y + box.height * 0.6 - 120 },
			);

		await flickUp();
		await expect(panel).toBeVisible();

		await body.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await flickUp();
		await expect(panel).toBeHidden();
	});

	// The attribute lives only as long as the exit, so it is watched for rather
	// than polled: a poll that lost the race would report a bug that is not there.
	const leavesTowards = async (page: Page, act: () => Promise<void>) => {
		await page.evaluate(() => {
			const layer = document.querySelector('[aria-label="Track information"]');
			if (!layer) return;
			(window as unknown as { leftTowards: string | null }).leftTowards = null;
			new MutationObserver(() => {
				const towards = layer.getAttribute("data-leaving");
				if (towards)
					(window as unknown as { leftTowards: string | null }).leftTowards =
						towards;
			}).observe(layer, {
				attributes: true,
				attributeFilter: ["data-leaving"],
			});
		});
		await act();
		await expect(trackInfo(page)).toBeHidden();
		return page.evaluate(
			() => (window as unknown as { leftTowards: string | null }).leftTowards,
		);
	};

	test("they leave the way they were sent", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height * 0.6;

		expect(
			await leavesTowards(page, () =>
				touchDrag(page, { x, y }, { x, y: y - 120 }),
			),
		).toBe("up");

		await openPanels(page, true);
		expect(
			await leavesTowards(page, () =>
				touchDrag(page, { x, y }, { x, y: y + 120 }),
			),
		).toBe("down");

		// A chevron names no direction, so it gets the one it came in by.
		await openPanels(page, true);
		expect(
			await leavesTowards(page, () =>
				trackInfo(page)
					.getByRole("button", { name: "Close track information" })
					.click(),
			),
		).toBe("down");
	});

	test("the first panel arrives with the layer rather than from the side", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');

		// Zero is "no sideways entrance": the layer is already sliding up, and a
		// second animation across it is what reads as arriving crooked.
		await expect(body).toHaveAttribute("data-direction", "0");

		const box = (await panel.boundingBox())!;
		const y = box.y + box.height * 0.6;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.8, y },
			{ x: box.x + box.width * 0.2, y },
		);
		await expect(panel.locator('[data-tab="details"]')).toHaveAttribute(
			"data-direction",
			"1",
		);
	});

	test("the panel reaches the edges, so its scrollbar is the screen's", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');

		const box = (await body.boundingBox())!;
		const view = page.viewportSize()!;
		expect(box.x).toBe(0);
		expect(box.x + box.width).toBe(view.width);

		// The content is still inset; it is only the scroller that is not.
		const line = (await body.getByText("Dancing in the dark").boundingBox())!;
		expect(line.x).toBeGreaterThanOrEqual(20);
	});

	test("the resume pill hovers over the lyric rather than riding it", async ({
		page,
	}) => {
		await playRow(page, 5);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');
		const pill = panel.getByRole("button", { name: "Resume following" });

		// Any manual scroll gives the follow up, which is what puts the pill on
		// screen in the first place.
		await body.evaluate((el) => {
			el.scrollTop = 200;
		});
		await expect(pill).toBeVisible();
		const first = (await pill.boundingBox())!;

		await body.evaluate((el) => {
			el.scrollTop = 900;
		});
		const second = (await pill.boundingBox())!;

		// The scroller is the panel, so a pill positioned against *it* is part of
		// what scrolls and leaves with the verse it was over.
		expect(second.y, "the pill scrolled with the lyric").toBe(first.y);
		const view = page.viewportSize()!;
		expect(view.height - (second.y + second.height)).toBeLessThan(40);
	});

	test("a flick down the header closes them", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.locator("header").boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height / 2 },
			{ x, y: box.y + box.height / 2 + 120 },
		);

		await expect(panel).toBeHidden();
	});
});

// The player is the track, so a sideways flick is the next one.
test.describe("skipping with a flick", () => {
	test.skip(({ isMobile }) => !isMobile, "this is the touch gesture");

	const flick = async (page: Page, from: number, to: number) => {
		const box = (await nowPlayingScreen(page).boundingBox())!;
		// Across the artwork, which is the middle of the screen and the thing the
		// gesture is aimed at.
		const y = box.y + box.height * 0.4;
		await touchDrag(
			page,
			{ x: box.x + box.width * from, y },
			{ x: box.x + box.width * to, y },
		);
	};

	test("leftwards is the next track and rightwards is the one before", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await expect.poll(() => player.player.activeItem.index).toBe(0);

		await flick(page, 0.8, 0.2);
		await expect.poll(() => player.player.activeItem.index).toBe(1);

		await flick(page, 0.2, 0.8);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
	});

	test("upwards opens the panels, and the screen stays where it was", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.5 },
			{ x, y: box.y + box.height * 0.5 - 120 },
		);

		await expect(trackInfo(page)).toBeVisible();
		// Up is not a skip, and it is not a dismissal either.
		expect(player.player.activeItem.index).toBe(0);
		await expect(page).toHaveURL(/#\/playing$/);
	});
});

test.describe("the cover wheel", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	// The suite runs with reduced motion, where the wheel deliberately does not turn at all. Its own case is below.
	test.use({ motion: "allow" });

	test("a flick turns the rim by one sleeve", async ({ page, player }) => {
		await playRow(page, 0);
		// Painted on mount rather than left unset, so the rim is where the hook thinks it is from the first frame.
		expect(await turnOf(page)).toBe("0deg");

		await across(page, 0.85, 0.25);
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		// One step round, not two and not a fraction: the rim settles on a detent.
		await expect.poll(() => turnOf(page)).toBe("-22deg");

		await across(page, 0.25, 0.85);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => turnOf(page)).toBe("0deg");
	});

	test("Previous turns the rim back, whoever pressed it", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		// The button on the screen. It turns at once, exactly as a swipe does, rather than waiting out the round trip.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => turnOf(page)).toBe("22deg");

		// And from the keyboard, which reaches the player without going through this screen or even through
		// `useTransport` -- so nothing turned the wheel and all it is told is that a track changed. The player never
		// says which way it moved, so the direction is read off what was asked of it.
		await page.keyboard.press("ControlOrMeta+ArrowRight");
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => turnOf(page)).toBe("0deg");

		await page.keyboard.press("ControlOrMeta+ArrowLeft");
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => turnOf(page)).toBe("22deg");
	});

	test("a track ending by itself goes forward, not back", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		// A skip that was asked for and never answered must not leave its direction lying around for the next track that
		// ends of its own accord to pick up.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => turnOf(page)).toBe("22deg");

		player.next();
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => turnOf(page)).toBe("0deg");
	});

	test("the sleeve is still there after the screen has been dismissed and reopened", async ({
		page,
	}) => {
		await playRow(page, 0);
		await settled(page);
		await across(page, 0.85, 0.25);
		await expect.poll(() => turnOf(page)).toBe("-22deg");

		// The screen is unmounted on dismissal, so the wheel comes back with nothing on it while the hook still remembers
		// how far round the rim is. Unpainted, every slot sits off screen and the player draws no cover at all.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await openNowPlaying(page);

		await expect.poll(() => turnOf(page)).toBe("-22deg");
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		// On screen rather than merely present: an unpainted rim leaves it a whole sleeve to the side.
		const box = (await current.locator("img").boundingBox())!;
		const screen = (await nowPlayingScreen(page).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(screen.x - 1);
		expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
	});

	test("a drag that does not get far enough springs back and skips nothing", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		// Far enough to take the axis, nowhere near far enough to mean anything.
		await across(page, 0.5, 0.44);
		await expect.poll(() => turnOf(page)).toBe("0deg");
		expect(player.player.activeItem.index).toBe(0);
	});

	test("what it turns to is a hold, where the next sleeve cannot be known", async ({
		page,
		player,
	}) => {
		// Shuffle, and set before anything plays: the slot either side is filled once, when the track lands, and what a
		// slot already holds is never replaced.
		await openLibrary(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);
		// And the player takes its time, which is the rest of the case: the turn is on screen before the track is.
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		const current = wheel(page).locator("[data-current]");
		await expect(current.locator(".loading")).toBeVisible();
		// Loading, not stopped. The identity holds its shape and says nothing rather than claiming there is nothing.
		await expect(nowPlayingScreen(page).locator("h1")).not.toHaveText(
			"Nothing playing",
		);

		// Then the real sleeve arrives in that same slot, without the wheel moving again.
		await expect(current.locator("img")).toBeVisible();
		expect(await turnOf(page)).toBe("-22deg");
	});

	test("under Default it turns straight onto the next sleeve, with no hold at all", async ({
		page,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		// The artwork endpoint is addressed by position, so the next row's sleeve was already in the slot before the
		// turn began. Nothing was asked of the player to get it and there is nothing to wait for.
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		await expect(current.locator(".loading")).toHaveCount(0);
	});

	test("a turn nothing answers is put back", async ({ page, player }) => {
		// The end of a playlist: the player takes `next`, plays nothing and reports nothing. Left alone the wheel would
		// sit for good on a sleeve that is never going to resolve.
		await openLibrary(page);
		await page.request.post("/__control/play", {
			data: { playlistId: "p1", index: 3 },
		});
		await expect.poll(() => player.player.activeItem.index).toBe(3);
		await openNowPlaying(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });

		await across(page, 0.85, 0.25);
		await expect.poll(() => turnOf(page)).toBe("-22deg");

		await expect.poll(() => turnOf(page), { timeout: 10_000 }).toBe("0deg");
		expect(player.player.activeItem.index).toBe(3);
	});
});

test.describe("the wheel while the sound is a stream", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	// Six seconds of lag, which is longer than the wheel waits before putting an unanswered turn back.
	test.use({
		motion: "allow",
		fooJean: { streamPrime: 6 },
		fooJeanToken: TOKEN,
	});
	test.setTimeout(120_000);

	test("holds the identity until the sound arrives, and never pairs it with the wrong sleeve", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);
		await openNowPlaying(page);

		const title = nowPlayingScreen(page).locator("h1");
		const leaving = await title.textContent();

		await across(page, 0.85, 0.25);
		await expect.poll(() => turnOf(page)).toBe("-22deg");

		// The rim is allowed to run ahead of the ear -- that is what makes the flick immediate -- but the identity beside
		// it must not go on naming the track that is leaving. A sleeve and a title belonging to two different songs is
		// the thing this exists to prevent, and it is worst here, where the gap is seconds rather than milliseconds.
		await expect(title).not.toHaveText(String(leaving));
		await expect(nowPlayingScreen(page).locator(`h1.loading`)).toBeVisible();

		// And the turn stands. The player answered at once; only the sound is late, and waiting on the ear here would
		// rewind a skip that had already landed.
		await page.waitForTimeout(6000);
		expect(await turnOf(page)).toBe("-22deg");

		await expect(title).not.toHaveText(String(leaving), { timeout: 60_000 });
		await expect(nowPlayingScreen(page).locator("h1.loading")).toHaveCount(0, {
			timeout: 60_000,
		});
	});
});

test.describe("the wheel where motion is refused", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);

	test("does not turn, and swaps the sleeve instead", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		await across(page, 0.85, 0.25);

		// The skip still happens -- what goes is the rotation, not the gesture.
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect(wheel(page)).toHaveCSS("transform", "none");
		// One sleeve on screen and no neighbours parked either side, because there is no rim for them to sit on.
		await expect(wheel(page).locator("[data-current]")).toHaveCSS(
			"opacity",
			"1",
		);
	});
});

test.describe("the gap a skip leaves", () => {
	// See API.md for what foobar2000 does during a skip and why.

	// Every title the screen showed, in order, caught as it changed: the gap is far too short to poll for.
	const watchTitles = (page: Page) =>
		page.evaluate(() => {
			const screen = document.querySelector("[data-now-playing]");
			if (!screen) throw new Error("the now playing screen is not mounted");

			const seen: string[] = [];
			const record = () => {
				const title = screen.querySelector("h1")?.textContent ?? "";
				if (title && title !== seen[seen.length - 1]) seen.push(title);
			};

			record();
			new MutationObserver(record).observe(screen, {
				subtree: true,
				childList: true,
				characterData: true,
			});
			Object.assign(window, { __titles: seen });
		});

	const titlesSeen = (page: Page) =>
		page.evaluate(() => (window as { __titles?: string[] }).__titles ?? []);

	test("the screen holds the track it has rather than emptying", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipGap", { data: { ms: 300 } });
		await watchTitles(page);

		// The skip is asked of the player rather than pressed: the transport is on the screen on a phone and in the
		// status bar on a desktop, and the gap is the same push either way.
		player.next();
		await expect.poll(() => player.player.activeItem.index).toBe(1);

		// Two titles and nothing between them: the one that was playing, then the one that is.
		const titles = await titlesSeen(page);
		expect(titles).not.toContain("Nothing playing");
		expect(titles).toHaveLength(2);
	});

	test("a real stop still says nothing is playing", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await watchTitles(page);

		// The gap and a stop are told apart by `playbackState`, so the empty state has to survive the hold.
		player.stop();

		await expect(nowPlayingScreen(page).locator("h1")).toHaveText(
			"Nothing playing",
		);
	});

	test("the header keeps the set it is playing from", async ({
		page,
		player,
	}) => {
		// All music, because a playlist played straight from has no set to name and the header would say nothing anyway.
		await page.goto("/#/all");
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		const header = nowPlayingScreen(page).locator("header");
		await expect(header).toContainText("Playing from");

		await page.request.post("/__control/skipGap", { data: { ms: 300 } });
		await watchTitles(page);
		player.next();

		// `usePlayingFrom` reads the active item's `playlistId`, which the gap blanks: unheld, the header falls back to
		// the contextless "Now playing" for as long as the skip takes.
		await expect(header).toContainText("Playing from");
		expect(await titlesSeen(page)).not.toContain("Nothing playing");
	});
});

test.describe("the identity on a phone", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold's identity is a column of its own and takes space from nothing",
	);

	test("the player is the caption to the picture, stars and all", async ({
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

	test("the layer over it keeps the title and the artist and drops the rest", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const head = panel.locator("header");

		await expect(head).toContainText("Los Calientes");
		await expect(head).toContainText("Babasónicos");
		// The album is a row in Details, two tabs away; rating is a deliberate act
		// with the screen underneath and the ⋯ menu both offering it.
		await expect(head).not.toContainText("Jessico");
		await expect(panel.getByRole("img", { name: /stars|Unrated/ })).toHaveCount(
			0,
		);
	});
});

// The layer's header title is set `nowrap`, so a long one is as wide as its
// content whatever the window is. 480 sits between the phone at 412 and the
// gatefold at 861 -- the only width where the layer and a shrinking window are
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
		// 480px is below the JS breakpoint, so this is the compact layer at both
		// projects' settings.
		const panel = await openPanels(page, true);
		await tab(panel, "Details").click();

		const screen = panel;
		const title = panel.locator("header p").first();

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
		for (const inside of [title, tab(panel, "Details")]) {
			const at = await inside.boundingBox();
			expect(
				(at?.x ?? 0) + (at?.width ?? 0),
				`${await inside.textContent()} runs past the right edge`,
			).toBeLessThanOrEqual(edge + 1);
		}
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

	test("it is offered on the Lyrics tab and nowhere else", async ({ page }) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);
		await tab(panel, "Lyrics").click();
		await expect(expand(page)).toBeVisible();

		await tab(panel, "Details").click();
		await expect(expand(page)).toHaveCount(0);
	});

	test("it is not offered when there is no lyric to expand", async ({
		page,
	}) => {
		await playRow(page, 3);
		await tab(nowPlayingScreen(page), "Lyrics").click();
		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(expand(page)).toHaveCount(0);
	});

	test("only the lyrics are left, and the X brings the screen back", async ({
		page,
	}) => {
		await playRow(page, 0);
		await tab(nowPlayingScreen(page), "Lyrics").click();
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
		await expect(tab(nowPlayingScreen(page), "Details")).toBeVisible();
	});

	test("Escape closes it, and closes only it", async ({ page }) => {
		await playRow(page, 0);
		await tab(nowPlayingScreen(page), "Lyrics").click();
		await expand(page).click();
		await expect(close(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(close(page)).toHaveCount(0);
		await expect(nowPlayingScreen(page)).toBeVisible();
	});
});
