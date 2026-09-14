import type { FakePlayer, Page } from "./fixtures.ts";
import {
	dropTheStream,
	expect,
	expectSettlesAt,
	globalControls,
	openLibrary,
	openSidebar,
	requestsTo,
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
