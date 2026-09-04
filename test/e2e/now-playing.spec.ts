import { KEYMAP } from "../../src/shared/keyboard/keymap.ts";
import type { Locator, Page } from "./fixtures.ts";
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
