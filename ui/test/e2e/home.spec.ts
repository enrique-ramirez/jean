import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	inSequence,
	OFFERS_NO_SHUFFLE,
	openSidebar,
	playedFrom,
	playerDeclaring,
	playRequests,
	scratchOf,
	sidebar,
	test,
	untilTheInstallIsKnown,
	viewHeader,
} from "./fixtures.ts";

// Recently played has a heading of its own. Every other shelf is inside
// Explore, whose row is whichever tab is active, so it is addressed by its tab.
const shelf = (page: Page, title: string) =>
	page.getByRole("heading", { level: 2, name: title });

const explore = (page: Page) => page.getByRole("region", { name: "Explore" });

const tab = (page: Page, title: string) =>
	page
		.getByRole("navigation", { name: "Shelves" })
		.getByRole("button", { name: title, exact: true });

const albumInExplore = (page: Page, album: string | RegExp) =>
	explore(page).getByRole("button", { name: album });

test.describe("the home screen", () => {
	test("it is where the root lands, not a playlist", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await expect(tab(page, "Most played")).toBeVisible();
	});

	test("the sidebar reads search, home, all music, then playlists", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		// The list arrives a poll after the static rows above it, so a read taken
		// the instant the sidebar opens can still be missing it.
		await expect(
			sidebar(page).getByRole("button", { name: "Default Playlist" }),
		).toBeVisible();

		const labels = await sidebar(page).getByRole("button").allInnerTexts();
		const home = labels.findIndex((entry) => entry.startsWith("Home"));
		const all = labels.findIndex((entry) => entry.startsWith("All music"));
		const firstPlaylist = labels.findIndex((entry) =>
			entry.startsWith("Default Playlist"),
		);

		expect(home).toBeGreaterThanOrEqual(0);
		expect(all).toBe(home + 1);
		expect(firstPlaylist).toBeGreaterThan(all);
	});

	test("a shelf says why each record is on it", async ({ page }) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		await expect(page.getByText(/[\d,]+ plays$/).first()).toBeVisible();
	});
});

test.describe("the library header", () => {
	test("it leads with the time, and counts underneath", async ({ page }) => {
		await page.goto("/");

		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toContainText(
			"of music",
		);
		// Uppercased in CSS, so the text itself is still sentence case.
		await expect(header).toContainText("Your library");

		await inSequence(["tracks", "albums", "artists"], (label: string) =>
			expect(header.getByText(label, { exact: true })).toHaveCount(1),
		);
		await expect(header.getByText("playlists", { exact: true })).toHaveCount(0);
	});

	test("each card ends in something to press", async ({ page, isMobile }) => {
		await page.goto("/");
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toBeVisible();

		await expect(header.locator('[data-door="albums"]')).toContainText(
			"most played",
		);
		await expect(header.locator('[data-door="artists"]')).toContainText(
			"most played",
		);

		// A link rather than a button, so cmd-click opens All music in a tab. The
		// role is the claim; a selector matching the href was a way of spelling it.
		// Desktop only: the phone hides this card in CSS, so it has no role at all
		// there -- and cmd-click is not a gesture a phone has.
		test.skip(isMobile, "the tracks card is not drawn on a phone");
		await expect(header.getByRole("link", { name: /tracks/ })).toHaveCount(1);
	});

	// Named for what it asserts: the negative half is the describe below, and a
	// future reader finding two tests under one promise deletes the wrong one.
	test("the genres block is drawn when the player has genre tags", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Genres" })).toBeVisible();
	});
});

test.describe("a library with no genre tag", () => {
	test.use({ withoutFields: ["%genre%"] });

	test("says nothing about genres rather than saying zero", async ({
		page,
	}) => {
		await page.goto("/");
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toBeVisible();

		await expect(page.getByRole("region", { name: "Genres" })).toHaveCount(0);
		await expect(
			page.getByRole("region", { name: "Your top tracks" }),
		).toBeVisible();
	});
});

test.describe("the closing band", () => {
	test("a top track opens All music and starts there", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		const tracks = page.getByRole("region", { name: "Your top tracks" });
		await expect(tracks).toBeVisible();

		const first = tracks.getByRole("button").first();
		const title = (await first.getAttribute("title"))?.split(" — ").pop();
		await first.click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);
		expect(scratchOf(player)!.title).toBe("#Jean [all music]");
		await expect
			.poll(() => scratchOf(player)!.items[playedFrom(player)?.index ?? -1])
			.toMatchObject({ "%title%": title });
	});

	test("a genre bar opens exactly the tracks it counted", async ({ page }) => {
		await page.goto("/");
		const bars = page.getByRole("region", { name: "Genres" });
		await expect(bars).toBeVisible();

		// The search index covers title, artist and album, not genre, so the bar
		// cannot be a search.
		// Scoped to the list: the section's heading is a link as well, and it opens
		// the genres index rather than a genre.
		const first = bars.getByRole("list").getByRole("link").first();
		const [genre, count] = (await first.innerText()).split("\n");
		await first.click();

		await expect(
			page.getByRole("heading", { level: 1, name: genre.trim() }),
		).toBeVisible();

		// `refsOfGenre` matches the tag the way `summarise` counts it: whole, and
		// through `tagKey`.
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			count.trim().replace(/,/g, ""),
		);
	});
});

test.describe("starting the library from the front door", () => {
	const headerButton = (page: Page, name: string) =>
		viewHeader(page).getByRole("button", { name, exact: true });

	const modesSent = (player: FakePlayer) =>
		player.requests
			.filter(
				(entry) =>
					entry.method === "POST" && entry.path === "/api/playback/mode",
			)
			.map((entry) => entry.body?.mode);

	test("Play opens All music and starts at the beginning", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(headerButton(page, "Play")).toBeVisible();
		await headerButton(page, "Play").click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);
		expect(scratchOf(player)!.title).toBe("#Jean [all music]");

		await expect.poll(() => playedFrom(player)?.index).toBe(0);

		// The playback order is global player state, and Play leaves it alone.
		await expectSettlesAt(player, () => modesSent(player), []);
	});

	test("Shuffle opens All music and turns the mode on", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await headerButton(page, "Shuffle").click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);

		await expect.poll(() => modesSent(player)).toContain("shuffleTracks");
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)!.guid);
	});

	test("either one agrees with the sidebar and the status bar", async ({
		page,
	}) => {
		await page.goto("/");
		await headerButton(page, "Shuffle").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Before the drawer: on a phone the sidebar covers the status bar.
		await expectPlayingFrom(page, "All music");
		await openSidebar(page);
		await expect(
			sidebar(page)
				.getByRole("button", { name: /All music/ })
				.getByLabel("Playing from here"),
		).toBeVisible();
	});
});

// Plain Shuffle is Shuffle tracks, or Random where the player has no Shuffle tracks. A player with
// neither has nothing for it to turn on, whatever else it shuffles by.
for (const [offer, playerState] of [
	["no shuffle", OFFERS_NO_SHUFFLE],
	[
		"Shuffle albums and Shuffle folders, and neither Shuffle tracks nor Random",
		playerDeclaring(["Default", "Shuffle (albums)", "Shuffle (folders)"]),
	],
] as const) {
	test.describe(`a front door on a player that offers ${offer}`, () => {
		test.use({ playerState });

		test("Shuffle goes and Play stays", async ({ page, player }) => {
			await page.goto("/");
			const head = viewHeader(page);
			await expect(
				head.getByRole("button", { name: "Play", exact: true }),
			).toBeVisible();
			await untilTheInstallIsKnown(player);
			await expect(
				head.getByRole("button", { name: "Shuffle", exact: true }),
			).toHaveCount(0);
		});
	});
}

test.describe("a front door with the component answering", () => {
	test("Play and Shuffle are both offered", async ({ page }) => {
		await page.goto("/");
		const head = viewHeader(page);
		await expect(
			head.getByRole("button", { name: "Play", exact: true }),
		).toBeEnabled();
		await expect(
			head.getByRole("button", { name: "Shuffle", exact: true }),
		).toBeEnabled();
	});
});

test.describe("all music", () => {
	test("it is the library with no filter on it", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
	});
});

// The captured plays are months old, and Recently played only holds the last
// thirty days, so one track of each played album is moved to two days ago.
const twoDaysAgo = (() => {
	const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
	);
})();

const PLAYED_LATELY = Object.fromEntries(
	["Los Calientes", "Tautou", "Nutshell", "Bloodhail"].map((title) => [
		title,
		{ "%lastfm_last_played%": twoDaysAgo },
	]),
);

test.describe("opening a shelf from its heading", () => {
	test.use({ retagged: PLAYED_LATELY });

	test("Explore opens whichever tab is showing, and starts nothing", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		await page.getByRole("link", { name: "Explore" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();

		await expectSettlesAt(player, () => scratchOf(player), undefined);
		await expectSettlesAt(player, () => playRequests(player).length, 0);
		expect(player.player.playbackState).toBe("stopped");
	});

	test("it leaves what is already playing alone", async ({ page, player }) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();
		await albumInExplore(page, /^Jessico/).click();
		// Polled on playback rather than on the fill: the playlist is written first
		// and played a round trip later, so the active item reads -1 until then.
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		const playing = player.player.activeItem.index;
		// `#/home` rather than the front door, which reopens the now-playing screen
		// over whatever is playing. What this test is about is the heading link.
		await page.goto("/#/home");
		await expect(shelf(page, "Recently played")).toBeVisible();
		await page.getByRole("link", { name: "Recently played" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Recently played" }),
		).toBeVisible();

		expect(scratchOf(player)!.title).toBe("#Jean [shelf: Most played]");
		expect(player.player.activeItem.index).toBe(playing);
	});

	test("the blurb under Recently played is not a target", async ({ page }) => {
		await page.goto("/");
		await expect(shelf(page, "Recently played")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Recently played" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /Where you have been lately/ }),
		).toHaveCount(0);
	});

	test("Recently played is a row of its own and never also a tab", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(shelf(page, "Recently played")).toBeVisible();

		await expect(tab(page, "Recently played")).toHaveCount(0);

		await expect(tab(page, "Most played")).toHaveAttribute(
			"aria-current",
			"true",
		);
	});
});

test.describe("playing from a shelf", () => {
	test("it plays the whole row, starting at the album you clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();
		expect(scratchOf(player)).toBeUndefined();

		// Jessico is not first on this shelf, so this also proves the click starts
		// where it was aimed.
		await albumInExplore(page, /^Jessico/).click();

		// Polled on the contents rather than the title: the playlist is named when
		// it is created and filled a round trip later, so a title assertion passes
		// while it is still empty.
		await expect
			.poll(() => scratchOf(player)?.items.length ?? 0)
			.toBeGreaterThan(12);
		const scratch = scratchOf(player);
		expect(scratch!.title).toBe("#Jean [shelf: Most played]");
		await expect.poll(() => playedFrom(player)?.id).toBe(scratch!.guid);
		expect(scratch!.items[playedFrom(player)!.index]["%title%"]).toBe(
			"Los Calientes",
		);

		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();
		await expect(
			page.locator('[role="row"][data-active="true"]'),
		).toContainText("Los Calientes");
	});
});

test.describe("an install with no play counts", () => {
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
		firstRun: true,
		settings: { "jean.settingsSeen": true },
	});

	test("the shelves that need them are simply not there", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();

		await expect(tab(page, "Most played")).toHaveCount(0);
		await expect(shelf(page, "Recently played")).toHaveCount(0);
		await expect(tab(page, "Remember these?")).toHaveCount(0);
	});

	test("and the screen still opens on something to press", async ({ page }) => {
		await page.goto("/");

		// Start somewhere is drawn at random and needs no listening history.
		await expect(tab(page, "Start somewhere")).toBeVisible();
		await expect(explore(page).getByRole("button").first()).toBeVisible();
	});
});

test.describe("where you are, in the sidebar", () => {
	const current = (page: Page) =>
		sidebar(page).locator('[aria-current="true"]');

	test("a library route does not also light up a playlist", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Home");

		await sidebar(page).getByRole("button", { name: "All music" }).click();
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("All music");

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Rock en Español");
	});
});

test.describe("a shelf says it is playing", () => {
	test("it appears in the sidebar and in the status bar, and survives leaving it", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		// Checked without opening the drawer: on a phone it would cover the card
		// the next line clicks.
		await expect(
			sidebar(page).getByRole("button", { name: "Most played" }),
		).toHaveCount(0);

		await albumInExplore(page, /^Jessico/).click();

		await expectPlayingFrom(page, "Most played");

		await openSidebar(page);
		const row = sidebar(page).getByRole("button", { name: /Most played/ });
		await expect(row).toBeVisible();
		await expect(row.getByLabel("Playing from here")).toBeVisible();

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(
			sidebar(page).getByRole("button", { name: /Most played/ }),
		).toBeVisible();
	});
});
