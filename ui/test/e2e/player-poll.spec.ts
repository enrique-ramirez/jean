import { en } from "../../src/shared/i18n/en.ts";
import { evaluate, type Track } from "../fake-api/state.ts";
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
	rowByTitle,
	scratchOf,
	sidebar,
	statusBar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";
import { openPanels, panelTab } from "./nowPlaying.ts";

const playToggle = (page: Page, name: "Play" | "Pause") =>
	statusBar(page).getByRole("button", { name, exact: true });

// The length the seek bar is scaled to, which is the playing track's. A person
// reads it off the bar and a screen reader announces it.
const seekBar = (page: Page) =>
	statusBar(page).getByRole("slider", { name: "Position" });

const ticksTaken = (player: FakePlayer) =>
	requestsTo(player, "/api/state").filter((one) => one.method === "GET").length;

const SUBSCRIPTION = "/api/query/updates";

// The four columns the playing track's name and identity arrive in. The
// now-playing panel's per-track read is addressed the same way, `player=true`
// with `trcolumns`, and this bundle keeps it: it is told apart by asking for the
// tags it draws rather than for all four of these.
const NAMES_THE_PLAYING_TRACK = ["%artist%", "%title%", "%path%", "%subsong%"];

// `player=true` is what asks beefweb for player state and `trcolumns` is the
// parameter the active item's columns come back in.
const asksForPlayerState = (path: string) => {
	const columns = new URLSearchParams(path.split("?")[1]).get("trcolumns");
	if (columns === null) return path.includes("player=true");
	const asked = columns.split(",");
	return NAMES_THE_PLAYING_TRACK.every((one) => asked.includes(one));
};

// Every beefweb request rather than the subscription alone: the now-playing
// panel's per-track read (`fetchActiveItemColumns` in `shared/api/beefweb.ts`)
// is the same `GET /api/query?player=true&trcolumns=…`, one-shot rather than
// pushed, and a watch scoped to the subscription cannot see that one.
const beefwebReadsOfPlayerState = (player: FakePlayer) =>
	player.requests
		.filter((one) => asksForPlayerState(one.path))
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

// The row All music turns over to the next album at. A track change has to swap
// a picture for a different one before anybody can see that it swapped, and
// every row above this one is the same sleeve.
const ANOTHER_ALBUM = { row: 7, title: "Break Blossom" };

const PLAYING_COVER = "/api/artwork/playing";

// beefweb's positional address, at any row. The wheel's two neighbours are the
// only thing left on it, so a slot that changed which of the two addresses it is
// drawn from shows up as a count here and nowhere else.
const POSITIONAL_COVER = /^\/api\/artwork\/[^/]+\/\d+$/;

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

// Every request that addresses a cover, at both of the addresses one is
// reachable at. Watching a single address would miss a picture asked for again
// under the other name, and that is the swap itself.
const coversAskedFor = (player: FakePlayer) =>
	player.requests
		.map((one) => routeOf(one.path))
		.filter((path) => path === PLAYING_COVER || POSITIONAL_COVER.test(path));

const drawnCover = (within: Locator) =>
	within.locator("[data-artwork='ok']").first();

const wheel = (page: Page) =>
	nowPlayingScreen(page).locator("[data-cover-wheel]");

// The three slots in the order the wheel lays them out: the one a backwards
// swipe turns onto, the one on screen, and the one a forwards swipe turns onto.
const slots = (page: Page) => wheel(page).locator("[data-artwork]");

const currentSlot = (page: Page) =>
	wheel(page).locator("[data-current] [data-artwork]");

// The cover on screen, which is a different component on each viewport rather
// than a narrower one: a phone turns a wheel of three sleeves and a desktop
// draws one. The phone's is found by which slot the wheel has turned to,
// because the wheel gives the sleeve it turns onto no accessible name.
const coverOnScreen = (page: Page, isMobile: boolean) =>
	isMobile
		? currentSlot(page)
		: nowPlayingScreen(page).locator("[data-artwork]").first();

// A fold of the pixels a slot is showing. The address the playing cover is drawn
// from carries no track in it, so reading it back would answer with whatever is
// playing now whether or not the slot ever swapped to it.
const sleeveDrawn = (sleeve: Locator) =>
	sleeve.evaluate(async (node) => {
		const image = node as HTMLImageElement;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		const paper = canvas.getContext("2d");
		if (!paper) throw new Error("no 2d context to read the sleeve through");
		paper.drawImage(image, 0, 0, canvas.width, canvas.height);

		let fold = 0;
		for (const level of paper.getImageData(0, 0, canvas.width, canvas.height)
			.data)
			fold = (fold * 31 + level) % 2_147_483_647;
		return fold;
	});

// A file dragged into foobar2000 from a folder the media library does not scan,
// which is how a track outside the library comes to be playing at all. Every tag
// is its own, so a panel that filled from the library rather than from whatever
// is playing would have nothing to fill with.
const DRAGGED_IN = {
	"%path%": "D:\\Incoming\\Night Sessions\\01 Fourth Wall.flac",
	"%title%": "Fourth Wall",
	"%artist%": "The Dry Season",
	"%album%": "Night Sessions",
	"%album artist%": "The Dry Season",
	"%tracknumber%": "01",
	"%genre%": "Slowcore",
	"%year%": "2019",
	"%codec%": "FLAC",
	"%bitrate%": "918",
	"%samplerate%": "44100",
	"%channels%": "stereo",
	"%length%": "3:32",
	"%length_seconds%": "212",
};

// An internet radio station, added to a playlist the way a person adds one, by
// its address rather than a file: there is nothing here for a rating to belong to.
const RADIO_STATION = {
	"%path%": "http://stream.example.org:8000/night-shift",
	"%title%": "Weightless",
	"%artist%": "Halo Choir",
	"%codec%": "MP3",
	"%bitrate%": "128",
};

// The song that station moves to a few minutes later, with the same address
// still playing. Neither field matches the playlist entry, so a status bar
// naming the entry's own tags names neither of them.
const ANNOUNCED = { title: "Ocean Floor", artist: "Gravity Wave" };

// The song after that one, announced as a bare title. Nothing was said about an
// artist, so the artist is the station's own tag again rather than either of the
// two above.
const ANNOUNCED_ALONE = { title: "Low Tide" };

// Short enough that the dropped file's row needs no scrolling to reach.
const DROPPED_INTO = "p1";

// A playing row with a different track directly above and below it, so an
// equaliser that lands one row out reads as a different title rather than as
// the same one again.
const PLAYING_ROW = { row: 3, title: "Soy Rock" };

// A different album from `PLAYING_ROW`'s, so a swapped cover reads differently
// from one that merely stayed drawn.
const A_DIFFERENT_ALBUM = { title: "Tautou" };

const UNRESOLVED = "?";

const ratingStars = (page: Page) =>
	nowPlayingScreen(page).getByRole("group", { name: /stars|Unrated/ });

// Either control, because what is asserted is absence. `Stars` is an `img` and
// `StarsInput` is a `group`, so a query for one alone passes against an inert
// row of stars, which is the thing a person must not be shown.
const anyRating = (page: Page) =>
	nowPlayingScreen(page)
		.getByRole("img", { name: /stars|Unrated/ })
		.or(nowPlayingScreen(page).getByRole("group", { name: /stars|Unrated/ }));

const tagWrites = (player: FakePlayer) =>
	requestsTo(player, "/api/tags").filter((one) => one.method === "POST");

const rawPlayingTrack = (player: FakePlayer) => {
	const { playlistId, index } = player.player.activeItem;
	const track = player.playlistById(playlistId)?.items[index];
	if (!track) throw new Error("nothing is playing to read a tag off");
	return track;
};

// Added at the player and played off the row it landed on, which is how anything
// the media library does not hold comes to be playing at all.
const addAndPlay = async (page: Page, player: FakePlayer, track: Track) => {
	const playlist = player.playlistById(DROPPED_INTO);
	if (!playlist) throw new Error(`no playlist ${DROPPED_INTO} to add to`);
	playlist.items.push(track);

	await page.goto(`/#/${DROPPED_INTO}`);
	await rowByTitle(page, track["%title%"]).dblclick();
	await expect(statusBar(page)).toContainText(track["%title%"]);
};

const playTheDroppedFile = async (page: Page, player: FakePlayer) => {
	expect(
		player.libraryTracks.map((track) => track["%path%"]),
		"the media library holds the track these cases are about",
	).not.toContain(DRAGGED_IN["%path%"]);

	await addAndPlay(page, player, DRAGGED_IN);
	await openNowPlaying(page);
};

// The gesture itself, driven through CDP the way the wheel's own spec drives it:
// a finger dragged left to right across the sleeve is Previous, and what the
// wheel does with a drag turns on the browser deciding the gesture is its.
const swipeToThePrevious = async (page: Page) => {
	const box = (await nowPlayingScreen(page).boundingBox())!;
	const y = box.y + box.height * 0.4;
	await touchDrag(
		page,
		{ x: box.x + box.width * 0.25, y },
		{ x: box.x + box.width * 0.85, y },
	);
};

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

test("the status bar follows a song a station announces, with the track never changing", async ({
	page,
	player,
}) => {
	// Emptied for the reason the case above gives, and for a second one: beefweb
	// evaluates its columns against whatever is playing, announcement included, so
	// a subscription left carrying them names the new song whether or not the poll
	// ever learns of it.
	player.answersTrackColumns = false;

	await addAndPlay(page, player, RADIO_STATION);

	player.announceSong(ANNOUNCED);

	await expect(statusBar(page)).toContainText(ANNOUNCED.title);
	await expect(statusBar(page)).toContainText(ANNOUNCED.artist);

	// The station is still the thing playing, at the row it was playing from. A
	// fake that swapped the track under the announcement would move the status
	// bar as well, and the assertions above would pass against the one thing this
	// case exists to rule out.
	expect(evaluate(rawPlayingTrack(player), "%path%")).toBe(
		RADIO_STATION["%path%"],
	);
	await expect(rowByTitle(page, RADIO_STATION["%title%"])).toHaveAttribute(
		"data-active",
		"true",
	);
});

test("a station announcing a title alone drops the artist it announced before", async ({
	page,
	player,
}) => {
	player.answersTrackColumns = false;

	await addAndPlay(page, player, RADIO_STATION);
	player.announceSong(ANNOUNCED);
	await expect(statusBar(page)).toContainText(ANNOUNCED.artist);

	// `publishName` in `plugins/fb2k/src/fb2k/playback_watch.cpp` runs both
	// title-format scripts on every announcement, so the second one settles the
	// artist as much as the title. There is no per-field memory to carry
	// "Gravity Wave" across, at the player or here.
	player.announceSong(ANNOUNCED_ALONE);

	await expect(statusBar(page)).toContainText(ANNOUNCED_ALONE.title);
	await expect(statusBar(page)).toContainText(RADIO_STATION["%artist%"]);
});

test("the equaliser follows the playing row through an edit above it, and ignores an edit elsewhere", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await expect(
		trackRow(page, PLAYING_ROW.row).getByLabel("Now playing"),
	).toBeVisible();

	// Removed at the desktop, above the playing row, so the row moves under
	// playback with no playback callback to report it. Item changes are not
	// pushed by a real player, so the shorter playlist has to be announced the
	// way a landing chunk announces itself. See state.ts.
	expect(player.removeItems("p7", [0])).toBe(true);
	player.notifyPlaylists();

	const moved = trackRow(page, PLAYING_ROW.row - 1);
	await expect(moved).toContainText(PLAYING_ROW.title);
	await expect(moved.getByLabel("Now playing")).toBeVisible();

	// And not on whatever slid up into the row it left, which is what a position
	// that stopped following looks like to somebody reading the list.
	await expect(
		trackRow(page, PLAYING_ROW.row).getByLabel("Now playing"),
	).toHaveCount(0);

	// An edit to a playlist that is not playing reaches nothing. The narrowing is
	// done by hand, and p2 holds neither the playing track nor the playing row, so
	// a callback that ran everywhere would look the item up in here, fail to find
	// it, and leave the equaliser no row to sit on.
	expect(player.removeItems("p2", [0])).toBe(true);
	player.notifyPlaylists();

	await expectSettlesAt(
		player,
		() => moved.getByLabel("Now playing").count(),
		1,
	);
});

test("a cover survives the playing row being pulled from its own playlist", async ({
	page,
	player,
	isMobile,
}) => {
	test.skip(!isMobile, "the wheel is the surface an absent location reaches");

	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await openNowPlaying(page);
	await expect(nowPlayingScreen(page)).toContainText(PLAYING_ROW.title);
	await expect(currentSlot(page)).toHaveAttribute("data-artwork", "ok");

	player.requests.length = 0;

	// The same edit the equaliser case above drives, on the row that is actually
	// playing: foobar2000 carries on and `playingLocation` goes absent.
	expect(player.removeItems("p7", [PLAYING_ROW.row])).toBe(true);
	expect(player.player.activeItem.index).toBe(-1);

	// The client only learns of this through the poll, so the assertions below have
	// to outlast a tick or they would pass on a screen that never heard about it.
	await expect.poll(() => ticksTaken(player)).toBeGreaterThanOrEqual(2);

	await expect(nowPlayingScreen(page)).toContainText(PLAYING_ROW.title);
	await expect(currentSlot(page)).toHaveAttribute("data-artwork", "ok");

	// The request, never what is drawn: a picture the browser already holds and a
	// picture a bare `<img src>` failed to fetch both look drawn a moment later,
	// and only the log says whether either one carried a bearer token.
	await expectSettlesAt(
		player,
		() =>
			requestsTo(player, PLAYING_COVER).filter(
				(one) => one.method === "GET" && !one.answered,
			),
		[],
	);

	// The pixels rather than the request log: a cover cached under this fixed
	// address rather than under the track would still read "ok" and answer
	// every header check, and only a track that plays after the pull shows
	// whether the sleeve is still following it.
	const wasShowing = await sleeveDrawn(currentSlot(page).locator("img"));

	const library = player.playlistById("p7");
	const at = library?.items.findIndex(
		(one) => one["%title%"] === A_DIFFERENT_ALBUM.title,
	);
	if (at === undefined || at < 0)
		throw new Error(`${A_DIFFERENT_ALBUM.title} is no longer in p7`);
	player.playItem("p7", at);
	await expect(nowPlayingScreen(page)).toContainText(A_DIFFERENT_ALBUM.title);

	await expect
		.poll(() => sleeveDrawn(currentSlot(page).locator("img")), {
			message: "the sleeve on screen is still the pulled row's",
		})
		.not.toBe(wasShowing);
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
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
	player.playItem("p7", 1);
	await expect(statusBar(page)).toContainText("Fizz");

	await expectSettlesAt(player, () => beefwebReadsOfPlayerState(player), []);

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

test("a neighbour becoming the centre asks for no cover at all", async ({
	page,
	player,
	isMobile,
}) => {
	test.skip(!isMobile, "the wheel is the phone's skip gesture");

	await openAllMusic(page);
	await trackRow(page, SECOND_IN_THE_ALBUM.row).dblclick();
	await expect(statusBar(page)).toContainText(SECOND_IN_THE_ALBUM.title);
	await openNowPlaying(page);

	// The slot the swipe below turns onto, already showing its picture. The
	// neighbours are not a prefetch: they are live sleeves, and what a swipe is
	// meant to reveal is one that is decoded and composited already.
	await expect(slots(page).first()).toHaveAttribute("data-artwork", "ok");
	player.requests.length = 0;

	await swipeToThePrevious(page);
	await expect.poll(() => player.player.activeItem.index).toBe(0);
	await expect(nowPlayingScreen(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await expect(currentSlot(page)).toHaveAttribute("data-artwork", "ok");

	// The request log, never what is drawn. A slot asked for a second time
	// answers with the bytes it was already showing, so it fills a frame later
	// and looks exactly like one that was never asked for. Nothing else is owed
	// a cover either: the row turned onto is the first and has no neighbour
	// behind it.
	await expectSettlesAt(player, () => coversAskedFor(player), []);
});

test("the sleeve swaps with the track, at an address that never moves", async ({
	page,
	player,
	isMobile,
}) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await openNowPlaying(page);

	// Drawn before it can swap. The address takes no track, so a slot handed an
	// empty sleeve has nothing to ask for again, and the screen keeps no cover
	// at all.
	const cover = coverOnScreen(page, isMobile);
	await expect(cover).toHaveAttribute("data-artwork", "ok");
	const wasShowing = await sleeveDrawn(cover.locator("img"));

	// Another album rather than the next track, because the two rows either side
	// of this one carry the same picture and a swap to one of those is a swap
	// nobody can see.
	player.playItem(player.player.activeItem.playlistId, ANOTHER_ALBUM.row);
	await expect(nowPlayingScreen(page)).toContainText(ANOTHER_ALBUM.title);

	// The picture rather than the words beside it. The address the sleeve is
	// drawn from carries no track, and the title and the album arrive from
	// somewhere else, so a screen naming the new album over the old album's
	// sleeve is the failure this is written against.
	await expect
		.poll(() => sleeveDrawn(coverOnScreen(page, isMobile).locator("img")), {
			message: "the sleeve on screen is still the album that stopped playing",
		})
		.not.toBe(wasShowing);
});

// The two below are one promise in two halves: a track the media library does
// not hold is read and written exactly as one it does. Neither half is addressed
// by the library, so both are owed nothing beyond what already works, and a
// panel that started branching on membership is what they are written against.
test("a track outside the media library fills the same panel, down to the lyrics empty state", async ({
	page,
	player,
	isMobile,
}) => {
	await playTheDroppedFile(page, player);

	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Details").click();

	await expect(panel).toContainText("Genre");
	await expect(panel).toContainText("Slowcore");
	await expect(panel).toContainText("Format");
	await expect(panel).toContainText("FLAC");
	await expect(panel).toContainText("918 kbps");

	await panelTab(panel, "Lyrics").click();

	// The catalogue's own phrase rather than a copy of it, so a copy edit to the
	// string does not also have to land here. The five assertions above it stay
	// hardcoded; this is the one that would drift from them.
	await expect(panel).toContainText(en["lyrics.none"]);
});

test("a track outside the media library can be rated, and the rating lands on the player", async ({
	page,
	player,
}) => {
	await playTheDroppedFile(page, player);

	// The interactive control, not the inert one beside it: `Stars` is an `img`
	// and `StarsInput` is a `group`, so the role is the whole assertion.
	await expect(ratingStars(page)).toHaveAccessibleName("Unrated");
	await ratingStars(page).getByRole("button", { name: "Rate 4 of 5" }).click();

	await expectSettlesAt(player, () => tagWrites(player).length, 1);
	expect(tagWrites(player)[0].body).toMatchObject({
		path: DRAGGED_IN["%path%"],
		fields: { rating: "4" },
	});

	// Read back off the player rather than out of Jean's own optimism. A refused
	// write rolls itself back already; what only a reload catches is a write
	// that answers `ok: true` without landing on the player's copy of the file.
	await page.reload();
	await expect(nowPlayingScreen(page)).toBeVisible();
	await expect(ratingStars(page)).toHaveAccessibleName("4 of 5 stars");
});

// The three below only pass together, and the third is what holds the other two
// honest. A station and an unrated file both answer `?` for `%rating%`, so a
// condition written against that sentinel hides the station and takes the file's
// stars with it, and rating an unrated track is the whole point of the control.
// The path is the only thing that tells the two apart.
test("a track with no local file draws no rating control at all", async ({
	page,
	player,
}) => {
	await addAndPlay(page, player, RADIO_STATION);
	await openNowPlaying(page);

	// The screen drew the track, so an absence below is an absence rather than a
	// screen that never arrived.
	await expect(nowPlayingScreen(page)).toContainText(RADIO_STATION["%title%"]);

	// Settled rather than read straight: a control that has not rendered yet is
	// also a count of zero.
	await expectSettlesAt(player, () => anyRating(page).count(), 0);
});

test("the track actions offer no rating for a track with no local file", async ({
	page,
	player,
}) => {
	await addAndPlay(page, player, RADIO_STATION);
	await openNowPlaying(page);
	await page.getByRole("button", { name: "Track actions" }).click();

	// The menu is the second way to reach the same write, and it asks the screen's
	// own hook whether to offer one. A fix made in the component that draws the
	// stars leaves this offering a rating the player would refuse.
	await expect(
		page.getByRole("menuitem", { name: "Add to queue" }),
	).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);
});

test("a local file with no rating tag keeps its interactive stars", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
	await openNowPlaying(page);

	expect(
		evaluate(rawPlayingTrack(player), "%rating%"),
		"this file now carries a rating, so the case no longer covers an unrated one",
	).toBe(UNRESOLVED);

	await expect(ratingStars(page)).toHaveAccessibleName("Unrated");
	await expect(
		ratingStars(page).getByRole("button", { name: "Rate 4 of 5" }),
	).toBeVisible();
});
