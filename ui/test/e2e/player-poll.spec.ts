import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	dropTheStream,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	globalControls,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSidebar,
	requestsTo,
	scratchOf,
	sidebar,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

const playToggle = (page: Page, name: "Play" | "Pause") =>
	statusBar(page).getByRole("button", { name, exact: true });

// The length the seek bar is scaled to, which is the playing track's. A person
// reads it off the bar and a screen reader announces it.
const seekBar = (page: Page) =>
	statusBar(page).getByRole("slider", { name: "Position" });

const ticksTaken = (player: FakePlayer) =>
	requestsTo(player, "/api/state").filter((one) => one.method === "GET").length;

const SUBSCRIPTION = "/api/query/updates";

// `player=true` is what asks beefweb for player state and `trcolumns` is the
// parameter the active item's columns come back in. Scoped to the subscription:
// the on-demand read behind the now-playing details carries both as well, and
// that one is a read rather than a live dependency.
const subscriptionsCarryingPlayerState = (player: FakePlayer) =>
	requestsTo(player, SUBSCRIPTION)
		.filter(
			(one) =>
				one.path.includes("player=true") || one.path.includes("trcolumns"),
		)
		.map((one) => one.path);

const routeOf = (path: string) => path.split("?")[0];

const askedForTheOldLibraryRoute = (player: FakePlayer) =>
	player.requests
		.filter((one) => routeOf(one.path) === "/api/library")
		.map((one) => one.path);

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

// The poll's own interval, restated rather than imported: `tsconfig.test.json`
// scopes which of `src/` a spec may reach and `playerPoll.ts` is outside it.
// `unit/playerPoll.test.ts` holds the module's own value.
const POLL_MS = 1000;

// Ticks counted over a window rather than sampled, because what a second poller
// costs is requests per unit of time and nothing in the page reports a rate.
const TICKS_WATCHED = 4;

// Track lengths, in seconds, off the captured library.
const LOS_CALIENTES = "277";
const FIZZ = "168";

// Album artist, album, track is the order All music lands in, so this is its
// first row rather than the captured library's first file.
const FIRST_IN_ALL_MUSIC = "Rotten Apple";

// Two more rows of that same album, since one cover is what a track change
// inside an album must not move. The second is far enough along that the cover
// wheel never prefetched it as a neighbour of the row playing before it.
const SECOND_IN_THE_ALBUM = { row: 1, title: "Nutshell" };
const LATER_IN_THE_ALBUM = { row: 3, title: "No Excuses" };

const PLAYING_COVER = "/api/artwork/playing";

// beefweb's address for the cover of the row something is playing from. The
// cover wheel still addresses the rows either side of it this way on purpose,
// so this names one row rather than the whole of beefweb's artwork.
const playingRowCovers = (player: FakePlayer) => {
	const { playlistId, index } = player.player.activeItem;
	return player.requests
		.filter((one) => one.path === `/api/artwork/${playlistId}/${index}`)
		.map((one) => one.path);
};

// What the component answered for the playing cover, in order. The path cannot
// say: a picture sent again and a picture revalidated are the same GET at the
// same address, and only one of the two costs anything.
const playingCoverAnswers = (player: FakePlayer) =>
	requestsTo(player, PLAYING_COVER)
		.filter((one) => one.method === "GET")
		.map((one) => ({
			conditional: one.answered?.conditional,
			status: one.answered?.status,
			carriedThePicture: (one.answered?.bytes ?? 0) > 0,
		}));

const drawnCover = (within: Locator) =>
	within.locator("[data-artwork='ok']").first();

test("shows what the player is actually doing on the next tick after several were refused", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(playToggle(page, "Pause")).toBeVisible();
	await expect(seekBar(page)).toHaveAttribute("aria-valuemax", LOS_CALIENTES);

	// A client has to be up to date before it can miss anything: two ticks taken
	// means the second one was conditional on what the first one answered with, so
	// the validator it holds through the outage is a real one.
	await expect.poll(() => ticksTaken(player)).toBeGreaterThanOrEqual(2);

	// beefweb's subscription writes the same cache key as the poll for as long as
	// both are live, so cutting the poll alone would leave the stream to do the
	// recovering and this would pass with the poll doing nothing at all. The route
	// is cut first so the reconnect has nothing to come back to.
	await page.route("**/api/query**", (route) => route.abort());
	await dropTheStream(page);

	player.fooJean.failState = 503;
	const refusedFrom = ticksTaken(player);
	const beefwebAtDrop = requestsTo(player, "/api/query").length;

	// Driven at the desktop while the client is blind: a different track and a
	// different transport state, so following one of the two cannot pass by luck.
	player.playItem("p7", 1);
	player.playPause();

	await expect
		.poll(() => ticksTaken(player))
		.toBeGreaterThanOrEqual(refusedFrom + 2);
	await expect(playToggle(page, "Pause")).toBeVisible();
	await expect(seekBar(page)).toHaveAttribute("aria-valuemax", LOS_CALIENTES);

	player.fooJean.failState = null;

	await expect(playToggle(page, "Play")).toBeVisible();
	await expect(seekBar(page)).toHaveAttribute("aria-valuemax", FIZZ);

	// And the poll is what caught up: beefweb answered nothing at all between the
	// stream going away and the status bar being right again.
	await expectSettlesAt(
		player,
		() => requestsTo(player, "/api/query").length,
		beefwebAtDrop,
	);
});

test("the status bar and the playing row follow a track change made at the player", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");

	// Driven at the desktop: somebody pressed next while the phone was in a
	// pocket, so nothing Jean did can be what moves the two views below.
	player.playItem("p7", 1);

	await expect(statusBar(page)).toContainText("Fizz");
	await expect(statusBar(page)).toContainText("Babasónicos");
	await expect(trackRow(page, 1)).toHaveAttribute("data-active", "true");
});

test("the status bar names the track with no columns from beefweb to name it from", async ({
	page,
	player,
}) => {
	// The case above passes whichever source the name came from, since beefweb's
	// subscription is still live and still carries `activeItem.columns`. With the
	// columns emptied the tick is the only place a name can arrive from, and the
	// rest of the subscription, the playlist list and the play queue, is untouched.
	player.answersTrackColumns = false;

	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");

	player.playItem("p7", 1);

	await expect(statusBar(page)).toContainText("Fizz");
	await expect(statusBar(page)).toContainText("Babasónicos");
});

test("the sidebar follows a playlist renamed at the player", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await openSidebar(page);
	await expect(
		sidebar(page).getByRole("button", { name: "Favorites" }),
	).toBeVisible();

	expect(player.renamePlaylist("p2", "Saturday night")).toBe(true);

	await expect(
		sidebar(page).getByRole("button", { name: "Saturday night" }),
	).toBeVisible();
	await expect(
		sidebar(page).getByRole("button", { name: "Favorites" }),
	).toHaveCount(0);
});

test("the queue panel follows a track queued at the player", async ({
	page,
	player,
	isMobile,
}) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	const controls = await globalControls(page, isMobile);
	await controls.getByRole("button", { name: /^Queue/ }).click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

	// Queued at the desktop, into a panel that is already open: a panel that only
	// read the queue as it opened would pass this the other way round.
	expect(player.queueAdd("p7", 3)).toBe(true);

	// The artist beside the title is what `qcolumns` carries, and `qcolumns` is
	// the parameter that has to survive the subscription being narrowed.
	const row = queuePanel(page).getByRole("listitem").first();
	await expect(row).toContainText("Soy Rock");
	await expect(row).toContainText("Babasónicos");
});

test("never subscribes to beefweb for player state", async ({
	page,
	player,
}) => {
	test.fixme(
		true,
		"UPDATES_URL in shared/api/beefweb.ts still asks for player=true and trcolumns, since the title and columns readTrack() resolves still have no source but that subscription; narrowing it moved to _todo/04-remaining-endpoints.md, which pairs it with restoring track identity",
	);

	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
	player.playItem("p7", 1);
	await expect(statusBar(page)).toContainText("Fizz");

	await expectSettlesAt(
		player,
		() => subscriptionsCarryingPlayerState(player),
		[],
	);

	// A subscription deleted rather than narrowed satisfies the absence above and
	// takes the playlist list and the queue panel's columns with it, so what it
	// keeps is asserted beside what it drops.
	const subscribed = requestsTo(player, SUBSCRIPTION).at(-1)?.path ?? "";
	expect(subscribed, "nothing subscribed to beefweb at all").not.toBe("");
	expect(subscribed).toContain("playlists=true");
	expect(subscribed).toContain("playQueue=true");
	expect(subscribed).toContain("qcolumns=");
});

test("asks the component for state once an interval, and nobody asks for the route it replaced", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await expect.poll(() => ticksTaken(player)).toBeGreaterThanOrEqual(1);

	const before = ticksTaken(player);
	// A window crossed on purpose, which is the only way to read a rate.
	await page.waitForTimeout(TICKS_WATCHED * POLL_MS);
	const taken = ticksTaken(player) - before;

	expect(taken, "the poll stopped asking").toBeGreaterThanOrEqual(
		TICKS_WATCHED - 1,
	);
	expect(taken, "something is polling as well as the poll").toBeLessThanOrEqual(
		TICKS_WATCHED + 1,
	);

	expect(askedForTheOldLibraryRoute(player)).toEqual([]);
});

// The two below only mean anything together. Jean names the set it is playing
// from by joining the place on the tick to a playlist it holds, and the second
// case is the join coming back with nothing. On its own it is satisfied by
// drawing no name ever, so the first one is what says the join still works.
test("names the set a track is playing from", async ({ page, player }) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect
		.poll(() => scratchOf(player)?.title, { timeout: 10_000 })
		.toBe("#Jean [all music]");

	await expectPlayingFrom(page, "All music");

	await openSidebar(page);
	await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(1);
});

test('draws no "Playing from" where it cannot name the playlist, rather than an empty one', async ({
	page,
	player,
}) => {
	player.fooJean.knowsPlayingLocation = false;

	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect
		.poll(() => scratchOf(player)?.title, { timeout: 10_000 })
		.toBe("#Jean [all music]");
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);

	await openNowPlaying(page);
	// The screen drew the track, so an absence below is an absence rather than a
	// page that never arrived.
	await expect(nowPlayingScreen(page)).toContainText(FIRST_IN_ALL_MUSIC);

	// The element, never its text. A label shipped with nothing after it still
	// reads "Playing from", so a text assertion passes against the exact failure
	// this case is written against. Settled rather than read straight: a label
	// that has not rendered yet is also a count of zero.
	await expectSettlesAt(
		player,
		() =>
			nowPlayingScreen(page)
				.locator("header")
				.getByText("Playing from", { exact: true })
				.count(),
		0,
	);

	await nowPlayingScreen(page)
		.getByRole("button", { name: "Close now playing" })
		.click();
	await expect(nowPlayingScreen(page)).toBeHidden();

	// And the equaliser has no row to sit on, so it draws nowhere.
	await openSidebar(page);
	await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(0);
});

// The three below are All music rather than a playlist view, because a playlist
// draws its own rows through beefweb's positional address and the playing row's
// cover would then be asked for by something other than the two surfaces these
// are about. All music draws its rows through the component instead.
test("the status bar asks for the playing cover at an address with no playlist row in it", async ({
	page,
	player,
}) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);

	// The sleeve drew, so the absence below is an absence rather than a cover
	// that never arrived at all.
	await expect(drawnCover(statusBar(page))).toBeVisible();
	await expect
		.poll(() => requestsTo(player, PLAYING_COVER).length)
		.toBeGreaterThan(0);

	await expectSettlesAt(player, () => playingRowCovers(player), []);
});

test("the now-playing screen asks for the playing cover at that same address", async ({
	page,
	player,
}) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await openNowPlaying(page);
	await expect(nowPlayingScreen(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await expect(drawnCover(nowPlayingScreen(page))).toBeVisible();
	player.requests.length = 0;

	// Driven at the player, and to a row further along the album rather than the
	// next one: the cover wheel prefetches the rows either side of the playing
	// one at beefweb's address on purpose, so a jump is what leaves the new
	// centre's own row unasked for by anything but this screen. On a phone the
	// status bar is unmounted while this screen is open, which is what makes the
	// screen the only surface left to ask.
	player.playItem(player.player.activeItem.playlistId, LATER_IN_THE_ALBUM.row);
	await expect(nowPlayingScreen(page)).toContainText(LATER_IN_THE_ALBUM.title);

	await expect
		.poll(() => requestsTo(player, PLAYING_COVER).length)
		.toBeGreaterThan(0);

	await expectSettlesAt(player, () => playingRowCovers(player), []);
});

test("a second track of the same album revalidates the cover rather than downloading it again", async ({
	page,
	player,
}) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await expect(drawnCover(statusBar(page))).toBeVisible();

	player.playItem(player.player.activeItem.playlistId, SECOND_IN_THE_ALBUM.row);
	await expect(statusBar(page)).toContainText(SECOND_IN_THE_ALBUM.title);

	// One address for both tracks, so the second carries the first one's
	// validator and the picture never leaves the browser. The component folds the
	// picture rather than anything about the track, which is what makes one album
	// one validator.
	await expectSettlesAt(player, () => playingCoverAnswers(player), [
		{ conditional: false, status: 200, carriedThePicture: true },
		{ conditional: true, status: 304, carriedThePicture: false },
	]);
});
