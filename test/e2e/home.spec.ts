import type { PlayerOption } from "../../src/shared/api/types.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	inSequence,
	openSidebar,
	playedFrom,
	requestsTo,
	scratchOf,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";

const shelf = (page: Page, title: string) =>
	page.getByRole("heading", { level: 2, name: title });

const albumOnShelf = (page: Page, title: string, album: string | RegExp) =>
	page
		.getByRole("region", { name: title })
		.getByRole("button", { name: album });

test.describe("the home screen", () => {
	test("it is where the root lands, not a playlist", async ({ page }) => {
		// Jean used to open on whichever playlist the player was on, which meant
		// the first thing you saw depended on what the desktop happened to be
		// doing. Home is a place; a playlist is a thing you go to!.
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await expect(shelf(page, "Most played")).toBeVisible();
	});

	test("the sidebar reads search, home, all music, then playlists", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

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
		await expect(shelf(page, "Most played")).toBeVisible();

		// The caption is the whole difference between a shelf and a query result:
		// "1,315 plays" is a reason to press play, "matches a predicate" is not.
		await expect(page.getByText(/[\d,]+ plays$/).first()).toBeVisible();
	});
});

test.describe("the library header", () => {
	test("it leads with the time, and counts underneath", async ({ page }) => {
		await page.goto("/");

		// The claim, then its evidence. A track count is a number; "85 days of
		// music" is a feeling, and the feeling is what a front door is for.
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toContainText(
			"of music",
		);
		// Uppercased in CSS, so the text itself is still sentence case.
		await expect(header).toContainText("Your library");

		await inSequence(
			["tracks", "albums", "artists", "genres", "playlists"],
			(label: string) =>
				expect(header.getByText(label, { exact: true })).toBeVisible(),
		);
	});

	test("the counts are of the user's music, not of Jean's plumbing", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toBeVisible();

		// `#Jean Library` is Jean's, and so is any scratch!. Counting them here
		// would make this header disagree with the sidebar two centimetres to its
		// left, which lists neither.
		const mine = player.playlists.filter(
			(entry) => !entry.title.startsWith("#Jean"),
		);
		await expect(header).toContainText(String(mine.length));
		expect(player.playlists.length).toBeGreaterThan(mine.length);
	});

	test("a figure the player cannot answer for is not drawn", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(
			viewHeader(page).getByText("genres", { exact: true }),
		).toBeVisible();
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

		// The rule the shelves already follow: a claim needs the data behind it, and
		// "0 genres" is not "this library has no genres", it is "Jean cannot tell".
		await expect(header.getByText("genres", { exact: true })).toHaveCount(0);
		await expect(header.getByText("tracks", { exact: true })).toBeVisible();
	});
});

test.describe("starting the library from the front door", () => {
	const headerButton = (page: Page, name: string) =>
		viewHeader(page).getByRole("button", { name, exact: true });

	const orderRequests = (player: FakePlayer) =>
		requestsTo(player, "/api/player").flatMap((entry) =>
			(entry.body?.options ?? [])
				.filter((option: PlayerOption) => option.id === "playbackOrder")
				.map((option: PlayerOption) => option.value),
		);

	test("Play opens All music and starts at the beginning", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(headerButton(page, "Play")).toBeVisible();
		await headerButton(page, "Play").click();

		// Where you end up: looking at the set you just started, not at the screen
		// you pressed it from!.
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(54);
		expect(scratchOf(player)!.title).toBe("#Jean [all music]");

		// From the top, which is what the word means everywhere else in the app.
		await expect.poll(() => playedFrom(player)?.index).toBe(0);

		// And it leaves the playback order alone. The mode is global player state
		// and the status bar owns it; a Play that quietly switched shuffle off
		// would be reaching across the app to do it.
		expect(orderRequests(player)).toHaveLength(0);
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
		await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(54);

		// The mode does the shuffling; this only opens the door. Playing a track
		// makes that playlist the active one and shuffle draws from it, so two
		// requests are the whole of it.
		await expect.poll(() => orderRequests(player).length).toBeGreaterThan(0);
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)!.id);
	});

	test("either one agrees with the sidebar and the status bar", async ({
		page,
	}) => {
		await page.goto("/");
		await headerButton(page, "Shuffle").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Before the drawer: on a phone the sidebar covers the status bar, and the
		// way into the now-playing screen is in it. "from <set>" moved there when
		// the screen was built -- the status bar had no room for a third line.
		await expectPlayingFrom(page, "All music");
		await openSidebar(page);
		await expect(
			sidebar(page)
				.getByRole("button", { name: /All music/ })
				.getByLabel("Playing from here"),
		).toBeVisible();
	});
});

test.describe("a front door on a player that offers no shuffle", () => {
	test.use({
		playerState: {
			playbackModes: ["Default", "Repeat (playlist)"],
			options: [
				{
					id: "playbackOrder",
					name: "Playback order",
					type: "enum",
					value: 0,
					enumNames: ["Default", "Repeat (playlist)"],
				},
			],
		},
	});

	test("Shuffle goes and Play stays", async ({ page }) => {
		await page.goto("/");
		const head = viewHeader(page);
		await expect(
			head.getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
		await expect(
			head.getByRole("button", { name: "Shuffle", exact: true }),
		).toHaveCount(0);
	});
});

test.describe("all music", () => {
	test("it is the library with no filter on it", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		// Every track the library holds, which is the whole point of the view.
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
	});
});

test.describe("opening a shelf from its heading", () => {
	test("the title opens the shelf and starts nothing", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(shelf(page, "Most played")).toBeVisible();

		await page.getByRole("link", { name: "Most played" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();

		// Browsing writes nothing and plays nothing. Opening a shelf to look at it
		// must not take the scratch playlist off whatever is already in it, and
		// must not interrupt what is playing -- that separation is the whole reason
		// the scratch holds the last set you *chose*.
		expect(scratchOf(player)).toBeUndefined();
		expect(requestsTo(player, "/player/play/")).toHaveLength(0);
		expect(player.player.playbackState).toBe("stopped");
	});

	test("it leaves what is already playing alone", async ({ page, player }) => {
		await page.goto("/");
		await expect(shelf(page, "Most played")).toBeVisible();
		await albumOnShelf(page, "Most played", /^Jessico/).click();
		// Polled on playback, not on the fill: the playlist is written first and
		// played a round trip later, so reading the active item the moment the
		// items land reads -1 and compares nothing to nothing.
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		const playing = player.player.activeItem.index;
		await page.goto("/");
		await expect(shelf(page, "Recently played")).toBeVisible();
		await page.getByRole("link", { name: "Recently played" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Recently played" }),
		).toBeVisible();

		// A different shelf, opened. The one being listened to is untouched.
		expect(scratchOf(player)!.title).toBe("#Jean [shelf: Most played]");
		expect(player.player.activeItem.index).toBe(playing);
	});

	test("the blurb under it is not a target", async ({ page }) => {
		await page.goto("/");
		await expect(shelf(page, "Most played")).toBeVisible();
		const link = page.getByRole("link", { name: "Most played" });
		await expect(link).toBeVisible();
		// The sentence explains why the records are there. Only the heading opens.
		await expect(
			page.getByRole("link", { name: /Where you have been lately/ }),
		).toHaveCount(0);
	});
});

test.describe("playing from a shelf", () => {
	test("it plays the whole row, starting at the album you clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(shelf(page, "Most played")).toBeVisible();
		expect(scratchOf(player)).toBeUndefined();

		// Jessico is not first on this shelf, so this also proves the click starts
		// where it was aimed rather than at the top of the row.
		await albumOnShelf(page, "Most played", /^Jessico/).click();

		// Polled on the contents, not the title: the playlist is named when it is
		// created and filled a round trip later, so a title assertion passes while
		// it is still empty.
		//
		// The row, not the album. Playing one record and stopping would make every
		// shelf twenty dead ends -- the point is that what follows the album is the
		// next album on the shelf.
		await expect
			.poll(() => scratchOf(player)?.items.length ?? 0)
			.toBeGreaterThan(12);
		const scratch = scratchOf(player);
		expect(scratch!.title).toBe("#Jean [shelf: Most played]");
		await expect.poll(() => playedFrom(player)?.plref).toBe(scratch!.id);
		expect(scratch!.items[playedFrom(player)!.index]["%title%"]).toBe(
			"Los Calientes",
		);

		// And it opens the shelf under its own name, with the playing row marked.
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();
		await expect(
			page.locator('[role="row"][data-active="true"]'),
		).toContainText("Los Calientes");
	});
});

test.describe("an install with no play counts", () => {
	// Most shelves are built out of play data. On a player without it they must
	// disappear rather than render empty -- a bare install gets a coherent app,
	// never a dead shelf.
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
		firstRun: true,
	});

	test("the shelves that need them are simply not there", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();

		await expect(shelf(page, "Most played")).toHaveCount(0);
		await expect(shelf(page, "Recently played")).toHaveCount(0);
		await expect(shelf(page, "You used to love this")).toHaveCount(0);
	});

	test("and the screen still opens on something to press", async ({ page }) => {
		await page.goto("/");

		// Every other shelf is built out of listening history, so a player with no
		// playback statistics would otherwise get a heading and nothing under it.
		// One row drawn at random needs no history at all, and every install has a
		// library -- an apology is not a home screen.
		await expect(shelf(page, "Start somewhere")).toBeVisible();
		await expect(
			page
				.getByRole("region", { name: "Start somewhere" })
				.getByRole("button")
				.first(),
		).toBeVisible();
	});
});

test.describe("where you are, in the sidebar", () => {
	const current = (page: Page) =>
		sidebar(page).locator('[aria-current="true"]');

	test("a library route does not also light up a playlist", async ({
		page,
	}) => {
		// `selectedId` falls back to the remembered or current playlist so that
		// leaving the search has somewhere to return to!. Passed to the sidebar
		// unconditionally, that lit Default Playlist up while Home was open -- two
		// rows claiming to be where you are.
		await page.goto("/");
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Home");

		await sidebar(page).getByRole("button", { name: "All music" }).click();
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("All music");

		// And a playlist route still marks its playlist.
		await page.goto("/#/p5");
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Rock en Español");
	});
});

test.describe("a shelf says it is playing", () => {
	test("it appears in the sidebar and in the status bar, and survives leaving it", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(shelf(page, "Most played")).toBeVisible();

		// Nothing before it is played: the row only exists while the shelf is the
		// thing playing. Checked without opening the drawer -- on a phone that
		// would cover the very card the next line clicks.
		await expect(
			sidebar(page).getByRole("button", { name: "Most played" }),
		).toHaveCount(0);

		await albumOnShelf(page, "Most played", /^Jessico/).click();

		await expectPlayingFrom(page, "Most played");

		await openSidebar(page);
		const row = sidebar(page).getByRole("button", { name: /Most played/ });
		await expect(row).toBeVisible();
		await expect(row.getByLabel("Playing from here")).toBeVisible();

		// Browsing away does not move playback, so the row and the status line stay
		// -- that is the whole point of separating what you are looking at from what
		// you are listening to!.
		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(
			sidebar(page).getByRole("button", { name: /Most played/ }),
		).toBeVisible();
	});
});
