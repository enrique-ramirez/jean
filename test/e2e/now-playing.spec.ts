import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// The now-playing screen: what it reads, and how it decides what to draw.
//
// The lyric tag is `$meta(unsynced lyrics)` and the name lies -- it holds LRC
// timestamps about a third of the time. Everything below is a real shape found
// in one 30,441-track library, not an invented one.

const LYRIC = {
	// Note the repeated timestamps on one line: a refrain sung twice, and common
	// enough that reading only the first would silently drop half of it.
	synced: [
		"[00:12.00]I never meant to",
		"[00:18.50][01:02.10]Give you all my time",
		"[00:24.00]Dancing in the dark",
		"[00:31.00]",
		"[01:20.00]And I don't mind",
	].join("\r\n"),

	plain: ["Wait a minute, let me finish", "", "I came committed"].join("\r\n"),

	// A NetEase rip of an instrumental: two credit lines and a marker, all inside
	// the first five seconds of a four-minute track. Counted, that is three
	// timestamps and a synced lyric; drawn, it is a karaoke view that fires three
	// times and then sits dead. It is *plain*.
	boilerplate: [
		"[00:00.00] 作词 : Marcus Fuereder",
		"[00:01.00] 作曲 : Marcus Fuereder",
		"[00:05.00]纯音乐，请欣赏",
	].join("\r\n"),
};

const TAGGED = {
	retagged: {
		"Los Calientes": { "$meta(unsynced lyrics)": LYRIC.synced },
		Fizz: { "$meta(unsynced lyrics)": LYRIC.plain },
		Deléctrico: { "$meta(unsynced lyrics)": LYRIC.boilerplate },
		// Soy Rock is deliberately left with no lyric tag at all -- the common
		// case, at 74.7% of the measured library.
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

		// Seeking to a line is exact on a local file, and it is the thing a
		// streaming client mostly cannot offer.
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

		// The refrain is sung at 0:18 and again at 1:02, so it appears twice --
		// reading only the first timestamp would drop the second chorus.
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

		// Three timestamps, so a count threshold would call this synced. They span
		// five seconds of a four-minute track, so it is drawn as plain text.
		await expect(nowPlayingScreen(page)).toContainText("Unsynced");
		await expect(nowPlayingScreen(page)).toContainText("纯音乐，请欣赏");
		// And the timestamps themselves are never shown as text.
		await expect(nowPlayingScreen(page)).not.toContainText("[00:00.00]");
	});

	test("no tag is a state rather than an explanation", async ({ page }) => {
		await playRow(page, 3);
		await tab(page, "Lyrics").click();

		// Met three times out of four while listening, so it says the one thing it
		// has to and stops. Where the tag comes from and what writes it belongs in
		// Settings, not in front of somebody who is playing an instrumental.
		await expect(nowPlayingScreen(page)).toContainText("No lyrics found");
		await expect(nowPlayingScreen(page)).not.toContainText("foo_openlyrics");
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
		// Three quarters of a real library has no lyric tag, so opening on Lyrics
		// would land on an empty panel most of the time.
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

		// The fake resolves nothing for these, exactly as a real player answers `?`
		// for a tag the file does not carry. A fixed grid would draw them as empty
		// cells, and empty cells read as Jean failing rather than as tags nobody
		// wrote.
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

		// Back where you were, rather than wherever the sidebar would have picked.
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
