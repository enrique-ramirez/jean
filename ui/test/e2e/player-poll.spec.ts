import type { Route } from "@playwright/test";
import { tagKey } from "../../src/domain/track/fields.ts";
import { en } from "../../src/shared/i18n/en.ts";
import {
	evaluate,
	type RecordedRequest,
	type Track,
} from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	coversByPosition,
	coversFromTheComponent,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	globalControls,
	guidOfPlaylist,
	holdThePoll,
	listenHere,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSidebar,
	requestsTo,
	rowByTitle,
	scratchOf,
	scrollTo,
	scrollUntilMounted,
	sidebar,
	statusBar,
	test,
	touchDrag,
	trackPlayed,
	trackRow,
	untilQuiet,
	withNoListOnScreen,
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

// beefweb answers player state at two addresses and only one of them takes a
// parameter: `player=true` on `/api/query` and on its subscription, and
// `GET /api/player`, which asks by route alone. A POST under `/api/player` is a
// transport command rather than a read of anything.
const readsPlayerStateOffBeefweb = (one: RecordedRequest) => {
	if (one.method !== "GET") return false;
	const [route, query] = one.path.split("?");
	return (
		route.startsWith("/api/player") ||
		new URLSearchParams(query).get("player") === "true"
	);
};

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

// One more row of that same album, since one cover is what a track change
// inside an album must not move.
const SECOND_IN_THE_ALBUM = { row: 1, title: "Nutshell" };

// The row All music turns over to the next album at. A track change has to swap
// a picture for a different one before anybody can see that it swapped, and
// every row above this one is the same sleeve.
const ANOTHER_ALBUM = { row: 7, title: "Break Blossom" };

// The library-relative address a record's cover is asked at, which is its earliest track in album
// order. The Default Playlist holds the first four rows of this one.
const FIRST_IN_ALBUM_ORDER =
	"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac";
const ONE_RECORD = "p1";

// Favorites, which crosses from one record into another: its first three rows are one and its next
// two the other. The second record's cover is asked for at a row above the one playing, so the
// address cannot be mistaken for the row's own path.
const TWO_RECORDS = {
	id: "p2",
	first: {
		row: 0,
		title: "Tautou",
		cover: "B/Brand New/(2003) Deja Entendu/01. Tautou.mp3",
	},
	second: {
		row: 4,
		title: "Fizz",
		cover: "B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3",
		own: "B/Babasónicos/(2001) Jessico/02. Fizz.mp3",
	},
};

const PLAYING_COVER = "/api/artwork/playing";

// Every request that asks for a cover, at both addresses one is reachable at:
// the component's playing cover and the component's by library path. Watching a
// single address would miss a picture asked for again under another name, and
// that is the swap itself.
const coversAskedFor = (player: FakePlayer) => [
	...requestsTo(player, PLAYING_COVER).map((one) => routeOf(one.path)),
	...coversFromTheComponent(player),
];

// A cover asked for at any address but the record's own: the playing route or the component's
// row. A track whose record the media library holds uses neither, and the positional one stays
// the fallback for a track it has no record for.
const coversAskedElsewhere = (player: FakePlayer) => [
	...requestsTo(player, PLAYING_COVER).map((one) => routeOf(one.path)),
	...coversByPosition(player),
];

const playAtThePlayer = async (
	page: Page,
	player: FakePlayer,
	playlistId: string,
	row: number,
) => {
	await page.request.post("/__control/play", {
		data: { playlistId, index: row },
	});
	await expect.poll(() => player.player.activeItem.index).toBe(row);
};

const drawnCover = (within: Locator) =>
	within.locator("[data-artwork='ok']").first();

const wheel = (page: Page) =>
	nowPlayingScreen(page).locator("[data-cover-wheel]");

// The slots with a picture on them, which at rest is all three: the one on
// screen and the one a swipe either way turns onto.
const drawnSlots = (page: Page) => wheel(page).locator("[data-artwork='ok']");

const currentSlot = (page: Page) =>
	wheel(page).locator("[data-current] [data-artwork]");

// The wheel's own count of how far it has turned, independent of what a slot
// is showing: `--turn` is `-position * --step`, so their ratio is `-position`
// whichever sleeve is drawn.
const detents = (page: Page) =>
	wheel(page).evaluate((el) => {
		const step = Number.parseFloat(
			getComputedStyle(el).getPropertyValue("--step"),
		);
		const turn = Number.parseFloat(el.style.getPropertyValue("--turn"));
		return Number.isFinite(turn) && step ? turn / step : null;
	});

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

// A set rather than a playlist row, because a set is what "Playing from" names.
const playTheTopOfAllMusic = async (page: Page, player: FakePlayer) => {
	await openAllMusic(page);
	await trackRow(page, 0).dblclick();
	await expect
		.poll(() => scratchOf(player)?.title, { timeout: 10_000 })
		.toBe("#Jean [all music]");
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);
};

// Both surfaces a set's name reaches, and the element rather than its text: a
// label shipped with nothing after it still reads "Playing from", which is the
// failure to catch. Settled rather than read straight, since a label that has
// not rendered yet is also a count of zero.
const expectNoPlayingFrom = async (page: Page, player: FakePlayer) => {
	await openNowPlaying(page);
	// The screen drew the track, so an absence below is an absence rather than a
	// page that never arrived.
	await expect(nowPlayingScreen(page)).toContainText(FIRST_IN_ALL_MUSIC);

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

	// And the poll is what caught up: beefweb answered nothing between the outage
	// and the status bar being right again.
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

// Details draws no title or artist row. The artist reaches the panel only
// through the album's address, which falls back to it where there is no album
// artist, so the station carries an album and no album artist. It carries a
// lyric too, so the lyric's own looks at a bare track add no read to a count.
const STATION_ALBUM = "Late Transmissions";
const ANNOUNCING_STATION = {
	...RADIO_STATION,
	"%album%": STATION_ALBUM,
	"$meta(unsynced lyrics)": "Night shift, all night",
};

const ANNOUNCED_NEXT = { title: "Undertow", artist: "Pale Harbour" };

const READING_DETAILS = en["details.reading"];

const stationAlbum = (panel: Locator) =>
	panel.getByRole("definition").getByRole("link", { name: STATION_ALBUM });

const albumBy = (artist: string) =>
	`#/album/${encodeURIComponent(tagKey(artist))}/${encodeURIComponent(tagKey(STATION_ALBUM))}`;

const detailsReadsFromNow = (player: FakePlayer) => {
	const before = requestsTo(player, "/api/track/playing").length;
	return () =>
		requestsTo(player, "/api/track/playing")
			.slice(before)
			.filter((one) => one.method === "GET");
};

const openStationDetails = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
) => {
	await addAndPlay(page, player, ANNOUNCING_STATION);
	await openNowPlaying(page);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Details").click();
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(RADIO_STATION["%artist%"]),
	);
	return panel;
};

test("a station announcing a song reads it into the details panel, with the screen left open", async ({
	page,
	player,
	isMobile,
}) => {
	const panel = await openStationDetails(page, player, isMobile);

	player.announceSong(ANNOUNCED);

	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED.artist),
	);
});

test("an announcement never draws the reading notice, and the previous song's rows stay up until the answer lands", async ({
	page,
	player,
	isMobile,
}) => {
	const panel = await openStationDetails(page, player, isMobile);
	await page.evaluate(
		({ reading, album }) => {
			const seen = { notice: 0, withoutRows: 0 };
			(window as unknown as { seen: typeof seen }).seen = seen;
			new MutationObserver(() => {
				const text = document.body.innerText;
				if (text.includes(reading)) seen.notice += 1;
				if (!text.includes(album)) seen.withoutRows += 1;
			}).observe(document.body, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		},
		{ reading: READING_DETAILS, album: STATION_ALBUM },
	);

	const held: { release?: () => void } = {};
	await page.route("**/api/track/playing**", (route) => {
		held.release = () => void route.continue();
	});
	player.announceSong(ANNOUNCED);
	await expect.poll(() => held.release !== undefined).toBe(true);

	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(RADIO_STATION["%artist%"]),
	);

	held.release?.();
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED.artist),
	);
	expect(
		await page.evaluate(() => (window as unknown as { seen: object }).seen),
	).toEqual({ notice: 0, withoutRows: 0 });
});

test("a second announcement while the first one's read hangs replaces it, and the panel settles on the second song", async ({
	page,
	player,
	isMobile,
}) => {
	const panel = await openStationDetails(page, player, isMobile);
	const reads = detailsReadsFromNow(player);
	Object.assign(player.fooJean, {
		hangPlayingTrack: true,
		playingTrackKnobsFor: 1,
	});

	player.announceSong(ANNOUNCED);
	await expect.poll(() => reads().length).toBe(1);
	player.announceSong(ANNOUNCED_NEXT);

	// Well inside the eight seconds the hung read is given: a panel that waited it
	// out before reading again would land on the same song, only late.
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED_NEXT.artist),
		{ timeout: 4_000 },
	);
	await page.waitForTimeout(3_000);
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED_NEXT.artist),
	);
});

test("each announcement asks for its song once, lyric included", async ({
	page,
	player,
	isMobile,
}) => {
	const panel = await openStationDetails(page, player, isMobile);
	const reads = detailsReadsFromNow(player);

	player.announceSong(ANNOUNCED);
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED.artist),
	);
	player.announceSong(ANNOUNCED_NEXT);
	await expect(stationAlbum(panel)).toHaveAttribute(
		"href",
		albumBy(ANNOUNCED_NEXT.artist),
	);

	await expectSettlesAt(player, () => reads().length, 2);
	for (const one of reads())
		expect(
			new URLSearchParams(one.path.split("?")[1]).getAll("columns"),
		).toContain("$meta(unsynced lyrics)");
});

// react-query keeps the data a failed refetch leaves behind, and here that is
// the song the station has already moved past.
test("an announcement's read that fails twice leaves no rows, and not the previous song's", async ({
	page,
	player,
	isMobile,
}) => {
	const panel = await openStationDetails(page, player, isMobile);
	const reads = detailsReadsFromNow(player);
	player.fooJean.failPlayingTrack = 500;

	player.announceSong(ANNOUNCED);
	await expectSettlesAt(player, () => reads().length, 2);
	await page.waitForTimeout(3_000);
	expect(reads()).toHaveLength(2);

	await expect(panel.getByRole("term")).toHaveCount(0);
	await expect(panel).not.toContainText(STATION_ALBUM);
	await expect(panel).not.toContainText(READING_DETAILS);
	await expect(panel).not.toContainText(en["details.nothingPlaying"]);
});

test("an announcement over a panel left empty by two failed reads says it is reading, then draws the song", async ({
	page,
	player,
	isMobile,
}) => {
	const reads = detailsReadsFromNow(player);
	player.fooJean.failPlayingTrack = 500;
	await addAndPlay(page, player, ANNOUNCING_STATION);
	await openNowPlaying(page);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Details").click();
	await expectSettlesAt(player, () => reads().length >= 2, true);
	await expect(panel.getByRole("term")).toHaveCount(0);

	player.fooJean.failPlayingTrack = null;
	const held: { release?: () => void } = {};
	await page.route("**/api/track/playing**", (route) => {
		held.release = () => void route.continue();
	});
	player.announceSong(ANNOUNCED);
	await expect.poll(() => held.release !== undefined).toBe(true);

	await expect(panel).toContainText(READING_DETAILS);
	held.release?.();
	// A gatefold turns to Lyrics when the answer carries one.
	await expect(async () => {
		await panelTab(panel, "Details").click();
		await expect(stationAlbum(panel)).toHaveAttribute(
			"href",
			albumBy(ANNOUNCED.artist),
			{ timeout: 1_000 },
		);
	}).toPass();
});

test("a station announcing a title alone drops the artist it announced before", async ({
	page,
	player,
}) => {
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

// beefweb pushes no callback for a row pulled from under playback, so the client
// only learns of it on the next poll; a caller's assertions have to outlast a tick
// or they would pass against a screen that never heard about it.
const pullPlayingRow = async (player: FakePlayer) => {
	player.requests.length = 0;
	expect(player.removeItems("p7", [PLAYING_ROW.row])).toBe(true);
	expect(player.player.activeItem.index).toBe(-1);
	await expect.poll(() => ticksTaken(player)).toBeGreaterThanOrEqual(2);
};

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

	// The same edit the equaliser case above drives, but on the row that is
	// actually playing.
	await pullPlayingRow(player);

	await expect(nowPlayingScreen(page)).toContainText(PLAYING_ROW.title);
	await expect(currentSlot(page)).toHaveAttribute("data-artwork", "ok");

	// The request, never what is drawn: a picture the browser already holds and a
	// freshly fetched one both look drawn a moment later, and only the log says
	// which one happened.
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

// `navigator.mediaSession` rather than the DOM: `useMediaSession` writes to a
// browser API with nothing on screen to read, and the name it publishes is the
// whole of what a spec can observe of it.
const sessionTitle = (page: Page) =>
	page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);

const remainingLabel = (page: Page) =>
	queuePanel(page).getByText(/left of this track$/);

test("the tab keeps the track's name when the playing row is pulled from its own playlist", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await expect.poll(() => page.title()).toContain(PLAYING_ROW.title);

	await pullPlayingRow(player);

	await expect.poll(() => page.title()).toContain(PLAYING_ROW.title);
});

test("the queue countdown keeps counting when the playing row is pulled from its own playlist", async ({
	page,
	player,
	isMobile,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	const controls = await globalControls(page, isMobile);
	await controls.getByRole("button", { name: /^Queue/ }).click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
	await expect(remainingLabel(page)).toBeVisible();

	await pullPlayingRow(player);

	await expect(remainingLabel(page)).toBeVisible();
	await expect(queuePanel(page)).not.toContainText(en["player.nothingPlaying"]);

	// Present is not enough: the position `positionAt` interpolates from is what
	// would freeze if it mistook the pulled row for nothing playing.
	const before = await remainingLabel(page).textContent();
	await page.waitForTimeout(2200);
	await expect
		.poll(() => remainingLabel(page).textContent(), {
			message: "the countdown is frozen",
		})
		.not.toBe(before);
});

test("the now-playing menu keeps offering the track's actions when the playing row is pulled from its own playlist", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await openNowPlaying(page);
	await expect(nowPlayingScreen(page)).toContainText(PLAYING_ROW.title);

	await pullPlayingRow(player);

	const more = nowPlayingScreen(page).getByRole("button", {
		name: en["track.actions"],
	});
	await expect(more).toBeEnabled();
	await more.click();
	await expect(
		page.getByRole("menuitem", { name: en["rating.title"] }),
	).toBeVisible();
});

test("the media session keeps naming the track when the playing row is pulled from its own playlist", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await listenHere(page);

	await expect.poll(() => sessionTitle(page)).toBe(PLAYING_ROW.title);

	await pullPlayingRow(player);

	// A lock screen goes on naming a track whose place in a playlist is gone,
	// which is the half of the session a pull can take away. The other half, that
	// it publishes no picture at all, is `media-session.spec.ts`.
	expect(await sessionTitle(page)).toBe(PLAYING_ROW.title);
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

// The two ways a playlist's rows can reach the client, told apart by route
// alone, because that is the whole of what the row cache promises: a changed
// row costs a changed row, and reading the playlist again costs the playlist.
const rowsRoute = (guid: string) => `/api/playlists/${guid}/items`;

const readsOf = (player: FakePlayer, route: string) =>
	player.requests
		.filter((one) => one.method === "GET" && routeOf(one.path) === route)
		.map((one) => one.path);

const wholeRowReads = (player: FakePlayer, guid: string) =>
	readsOf(player, rowsRoute(guid));

const changeReads = (player: FakePlayer, guid: string) =>
	readsOf(player, `${rowsRoute(guid)}/changes`);

const rowReadsFor = (player: FakePlayer, guid: string) => [
	...wholeRowReads(player, guid),
	...changeReads(player, guid),
];

// A four-row playlist, short enough that every row is mounted.
const WATCHED = { id: "p1", title: "Default Playlist", first: "Rotten Apple" };

// A second playlist, read before the watched one and still held in the cache
// behind it.
const ALSO_HELD = { id: "p2", title: "Favorites" };

// A retitle at the player: the row stays where it is and answers differently,
// which is the one case the changes route exists for.
const RETITLED = "Rotten Apple (2024 remaster)";

// `WATCHED` sorted by title through the fake's own collator. A sort keeps every
// row and the count with it, so the structure generation is the only thing that
// says the rows moved.
const SORTED_FIRST = "I Stay Away";
const SORTED_LAST = "Rotten Apple";

// A tag corrected at the player and the file moved to match, in one edit: the
// row keeps its position, so the structure generation stays where it is and the
// row's new library path arrives on the changes route. `%path%` is none of the
// columns Jean reads, so that path reaches it as the changed row's `libraryPath`
// and nowhere else. The record moves with the file because a cover is held by
// the record it belongs to: a path that moves under an unchanged album asks for
// nothing, since the picture is already in hand.
const MOVED = {
	album: "Jessico",
	albumArtist: "Babasónicos",
	path: "C:\\Music\\B\\Babasónicos\\(2001) Jessico\\01. Los Calientes.mp3",
	cover: "B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3",
};

// Where `WATCHED`'s first row is addressed before that edit.
const MOVED_FROM =
	"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac";

// Every cover Jean has asked the component for, by the address it asked at,
// which is the library path it holds for the row. `/api/artwork/playing` is
// addressed by nothing and never appears here.
const coverAsks = (player: FakePlayer) =>
	requestsTo(player, "/api/artwork?").map(
		(one) => new URLSearchParams(one.path.split("?")[1]).get("track") ?? "",
	);

// A playlist reached by its GUID, which is what the route hash carries and what
// every row read names it by.
const openPlaylistView = async (
	page: Page,
	player: FakePlayer,
	playlist: { id: string; title: string },
) => {
	await page.goto(`/#/${guidOfPlaylist(player, playlist.id)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: playlist.title }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

// A tag written anywhere but Jean, landing on a row already on screen.
// `retagPlaying` is the fake's only content change that leaves a row where it
// is, so the row has to be the playing one; nothing the cache promises turns on
// that. The request log is emptied last, so everything counted afterwards is
// what this edit cost.
const editTheFirstRow = async (
	page: Page,
	player: FakePlayer,
	fields: Track,
) => {
	player.playItem(WATCHED.id, 0);
	await expect(statusBar(page)).toContainText(WATCHED.first);

	player.requests.length = 0;
	player.retagPlaying(fields);
};

const retitleTheFirstRow = (page: Page, player: FakePlayer) =>
	editTheFirstRow(page, player, { "%title%": RETITLED });

test("patches a row changed at the player in, rather than reading the playlist's rows again", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	const guid = guidOfPlaylist(player, WATCHED.id);

	await retitleTheFirstRow(page, player);

	await expect(trackRow(page, 0)).toContainText(RETITLED);
	await expect.poll(() => changeReads(player, guid).length).toBeGreaterThan(0);
	await expectSettlesAt(player, () => wholeRowReads(player, guid), []);
});

test.describe("with each playlist's window of changed positions spent", () => {
	test.use({ fooJean: { playlistChangeWindow: 0 } });

	test("reads the whole playlist again when the changes route says the revision is gone", async ({
		page,
		player,
	}) => {
		await openPlaylistView(page, player, WATCHED);
		const guid = guidOfPlaylist(player, WATCHED.id);

		await retitleTheFirstRow(page, player);

		await expect(trackRow(page, 0)).toContainText(RETITLED);
		await expect
			.poll(() => changeReads(player, guid).length)
			.toBeGreaterThan(0);
		await expect
			.poll(() => wholeRowReads(player, guid).length)
			.toBeGreaterThan(0);
	});
});

// A patch appends what it answered to the row cache's dictionaries and nothing
// evicts it while the playlist stays open, so what the waste is measured in is
// characters: one lyric-sized value outweighs a thousand ratings, and an edit
// count cannot tell the two apart. The two runs below are the same edit at two
// sizes, and the small one is what says the case is not had by reading the
// playlist whole every time.
//
// `%genre%` carries the characters because Jean holds it as a row column and
// draws it in no default column set, so what a run costs the cache is not what
// it costs layout.
const BULKY_CHARS = 256 * 1024;

const SMALL_EDITS = 3;
const BULKY_EDITS = 8;

const editedTitle = (at: number) => `${RETITLED} [${at}]`;

const smallGenre = (at: number) => `Alternative ${at}`;

const bulkyGenre = (at: number) => smallGenre(at).padEnd(BULKY_CHARS, "x");

const tagsFor = (at: number, genre: (at: number) => string): Track => ({
	"%title%": editedTitle(at),
	"%genre%": genre(at),
});

const expectRowShows = (page: Page, at: number) =>
	expect(rowByTitle(page, editedTitle(at))).toBeVisible();

// Each edit is waited for by the value it wrote, because two edits made inside
// one poll reach the client as one changed row: the one in between would cost
// the cache nothing and the run would never add up to what it claims.
const retagAndWait = async (
	page: Page,
	player: FakePlayer,
	at: number,
	genre: (at: number) => string,
) => {
	player.retagPlaying(tagsFor(at, genre));
	await expectRowShows(page, at);
};

test("goes on patching small changes into a playlist, and reads its rows whole again once the patches have appended enough characters", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	const guid = guidOfPlaylist(player, WATCHED.id);

	await editTheFirstRow(page, player, tagsFor(1, smallGenre));
	await expectRowShows(page, 1);
	for (let at = 2; at <= SMALL_EDITS; at += 1)
		await retagAndWait(page, player, at, smallGenre);

	expect(changeReads(player, guid).length).toBeGreaterThanOrEqual(SMALL_EDITS);
	await expectSettlesAt(player, () => wholeRowReads(player, guid), []);

	player.requests.length = 0;
	const last = SMALL_EDITS + BULKY_EDITS;
	for (let at = SMALL_EDITS + 1; at <= last; at += 1)
		await retagAndWait(page, player, at, bulkyGenre);

	await expect
		.poll(() => wholeRowReads(player, guid).length)
		.toBeGreaterThan(0);

	// A refresh rather than a reset: the row the reload answered carries the
	// last edit, and the count holds once the player has gone quiet.
	await expectSettlesAt(
		player,
		() => rowByTitle(page, editedTitle(last)).count(),
		1,
	);
});

// The cap the client reads the playlist whole at, from `MAX_APPENDED_CHARS` in
// `domain/track/playlistStore.ts`.
const APPEND_CAP = 256 * 1024;

// A bulk retag reaches many rows with one value. Whether that value arrives once
// or once per changed row is invisible from outside the client, since both patch
// the same rows and draw the same screen, so what the repeat costs the row cache
// is what tells them apart. The run below repeats one long value at a size where
// a copy per changed row crosses the cap and one copy per distinct value does
// not.
const SHARED_ROWS = 4;

const SHARED_CHARS = 70 * 1024;

const SHARED_ROUNDS = 3;

const sharedGenre = (round: number) =>
	`Retagged together ${round}`.padEnd(SHARED_CHARS, "x");

// Distinct per row, so a row drawing its neighbour's new value fails rather than
// reading as a repeat of the value they genuinely share.
const titleOfRow = (round: number, at: number) => `Retagged ${round}.${at}`;

// One synchronous run per round, because a poll landing mid-round splits it into
// two responses and neither carries enough rows to cost what this case measures.
const retagEveryRow = (player: FakePlayer, round: number) => {
	for (let at = 0; at < SHARED_ROWS; at += 1) {
		player.playItem(WATCHED.id, at);
		player.retagPlaying({
			"%title%": titleOfRow(round, at),
			"%genre%": sharedGenre(round),
		});
	}
};

test("patches a long value every changed row shares, where a copy per changed row would have crossed the cap", async ({
	page,
	player,
}) => {
	expect(
		SHARED_ROWS * SHARED_CHARS,
		"a copy per changed row has to cross the cap, or the run measures nothing",
	).toBeGreaterThan(APPEND_CAP);
	expect(
		SHARED_ROUNDS * SHARED_CHARS,
		"one copy per distinct value has to stay under the cap for the whole run",
	).toBeLessThan(APPEND_CAP);

	await openPlaylistView(page, player, WATCHED);
	const guid = guidOfPlaylist(player, WATCHED.id);
	player.requests.length = 0;

	for (let round = 1; round <= SHARED_ROUNDS; round += 1) {
		retagEveryRow(player, round);
		for (let at = 0; at < SHARED_ROWS; at += 1)
			await expect(trackRow(page, at)).toContainText(titleOfRow(round, at));
	}

	await expectSettlesAt(player, () => wholeRowReads(player, guid), []);
	expect(changeReads(player, guid).length).toBeGreaterThanOrEqual(
		SHARED_ROUNDS,
	);
});

test("reads the whole playlist again when its rows are reordered at the player, rather than patching", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	const guid = guidOfPlaylist(player, WATCHED.id);

	player.requests.length = 0;
	expect(player.sortItems(WATCHED.id, { by: "%title%" })).toBe(true);

	await expect(trackRow(page, 0)).toContainText(SORTED_FIRST);
	await expect(trackRow(page, 3)).toContainText(SORTED_LAST);
	await expect
		.poll(() => wholeRowReads(player, guid).length)
		.toBeGreaterThan(0);
	await expectSettlesAt(player, () => changeReads(player, guid), []);
});

const structureGenerationOf = (player: FakePlayer, id: string) => {
	const found = player.playlists.find((entry) => entry.id === id);
	if (!found) throw new Error(`no playlist ${id}`);
	return found.structure;
};

// A reorder steps the structure generation by one, and the counter is seeded
// where a double's ULP is 1024, so a client reading it as a number holds the
// same row-cache key either side of this edit: the rows are never read again
// and the screen keeps the old order. The two reads of the player below pin that
// seed, because a smaller one agrees with such a client by coincidence and puts
// this case to sleep.
test("redraws rows reordered at the player where a double cannot tell the two generations apart", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	await expect(trackRow(page, 0)).toContainText(WATCHED.first);
	const before = structureGenerationOf(player, WATCHED.id);

	expect(player.sortItems(WATCHED.id, { by: "%title%" })).toBe(true);

	const after = structureGenerationOf(player, WATCHED.id);
	expect(after, "the reorder has to move the structure generation").not.toBe(
		before,
	);
	expect(
		Number(after),
		"both generations have to land on one double, or this case guards nothing",
	).toBe(Number(before));

	await expect(trackRow(page, 0)).toContainText(SORTED_FIRST);
	await expect(trackRow(page, 3)).toContainText(SORTED_LAST);
});

test("asks nothing about a second playlist it still holds when one playlist's row changes", async ({
	page,
	player,
}) => {
	// Read first and left behind, so the cache holds its rows while another
	// playlist is the one on screen.
	await openPlaylistView(page, player, ALSO_HELD);
	const idle = guidOfPlaylist(player, ALSO_HELD.id);
	await openPlaylistView(page, player, WATCHED);

	await retitleTheFirstRow(page, player);

	await expect(trackRow(page, 0)).toContainText(RETITLED);
	await expectSettlesAt(player, () => rowReadsFor(player, idle), []);
});

// The first changes read, answered by the player and then held open, so a second
// edit can be made while it is still out. Held after the answer rather than on
// its way out: a request stopped before it reaches the player comes back
// carrying both edits at once, and a run built on that measures nothing.
const holdTheFirstChangesRead = async (page: Page) => {
	let taken = false;
	let answered = () => {};
	let release = () => {};
	const onTheWire = new Promise<void>((resolve) => {
		answered = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});

	await page.route(
		(url) => url.pathname.endsWith("/items/changes"),
		async (route) => {
			if (taken) return route.continue();
			taken = true;

			const response = await route.fetch();
			const body = await response.body();
			answered();
			await held;
			await route.fulfill({ response, body });
		},
	);

	return { onTheWire, release: () => release() };
};

const PATCHED_ONCE = "Rotten Apple (first pass)";

const PATCHED_TWICE = "Rotten Apple (second pass)";

test("shows both changes to a row where the second was made while the first was still being read", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	player.playItem(WATCHED.id, 0);
	await expect(statusBar(page)).toContainText(WATCHED.first);

	const firstRead = await holdTheFirstChangesRead(page);
	const poll = await holdThePoll(page);

	player.retagPlaying({ "%title%": PATCHED_ONCE });
	poll.letOneThrough();
	await firstRead.onTheWire;

	player.retagPlaying({ "%title%": PATCHED_TWICE });
	poll.letOneThrough();
	await poll.untilRefusedAgain();

	firstRead.release();
	await expect(trackRow(page, 0)).toContainText(PATCHED_TWICE);
});

// The component answers this when foobar2000 did not finish in time, which a
// busy player reaches on its own. `409` and `410` are the only refusals the
// changes route has a reload for, so this one and every other status have
// nowhere of their own to land.
const PLAYER_TOO_SLOW = 504;

// A refusal the browser hands to the page as a status rather than as a network
// failure.
const refuseWith = (status: number) => (route: Route) =>
	route.fulfill({ status });

// A wifi blip: the request leaves and nothing comes back.
const dropTheConnection = (route: Route) => route.abort();

// One changes read failed, and every read after it answered.
const failTheNextChangesRead = async (
	page: Page,
	refuse: (route: Route) => Promise<void>,
) => {
	let taken = false;
	let failed = () => {};
	const hasFailed = new Promise<void>((resolve) => {
		failed = resolve;
	});

	await page.route(
		(url) => url.pathname.endsWith("/items/changes"),
		async (route) => {
			if (taken) return route.continue();
			taken = true;
			await refuse(route);
			failed();
		},
	);

	return { hasFailed };
};

const PATCHED_AFTER_A_FAILURE = "Rotten Apple (after the failure)";

// Two tags written at the player, with the read that would have carried the
// first one failing. The second is written only once that failure has happened:
// two edits inside one poll reach the client as one changed row, so the failed
// read would carry both and leave nothing for a later one to bring.
const editTwiceAcrossAFailedChangesRead = async (
	page: Page,
	player: FakePlayer,
	refuse: (route: Route) => Promise<void>,
) => {
	await openPlaylistView(page, player, WATCHED);
	const { hasFailed } = await failTheNextChangesRead(page, refuse);

	await retitleTheFirstRow(page, player);
	await hasFailed;

	player.retagPlaying({ "%title%": PATCHED_AFTER_A_FAILURE });
};

test("a changes read the player is too slow for leaves the rows catching up on the next edit, and nothing uncaught on the page", async ({
	page,
	player,
}) => {
	const uncaught: string[] = [];
	page.on("pageerror", (error) => uncaught.push(error.message));

	await editTwiceAcrossAFailedChangesRead(
		page,
		player,
		refuseWith(PLAYER_TOO_SLOW),
	);

	await expect(trackRow(page, 0)).toContainText(PATCHED_AFTER_A_FAILURE);
	await expectSettlesAt(player, () => uncaught, []);
});

// A quiet player is the case the next edit cannot rescue: nothing else moves a
// revision, so a read lost to a blip has to be asked for again on its own.
test("a changes read lost on a quiet player catches up with no further edit", async ({
	page,
	player,
}) => {
	const uncaught: string[] = [];
	page.on("pageerror", (error) => uncaught.push(error.message));

	await openPlaylistView(page, player, WATCHED);
	const { hasFailed } = await failTheNextChangesRead(
		page,
		refuseWith(PLAYER_TOO_SLOW),
	);

	await retitleTheFirstRow(page, player);
	await hasFailed;

	await expect(trackRow(page, 0)).toContainText(RETITLED);
	await expectSettlesAt(player, () => uncaught, []);
});

test("a changes read the network drops leaves the rows catching up on the next edit, and nothing uncaught on the page", async ({
	page,
	player,
}) => {
	const uncaught: string[] = [];
	page.on("pageerror", (error) => uncaught.push(error.message));

	await editTwiceAcrossAFailedChangesRead(page, player, dropTheConnection);

	await expect(trackRow(page, 0)).toContainText(PATCHED_AFTER_A_FAILURE);
	await expectSettlesAt(player, () => uncaught, []);
});

// `FIRST_CHUNK` and `CHUNK_SIZE` in `domain/track/playlistStore.ts`: a playlist
// arrives one page at a time, and a third page is what leaves a prefix on screen
// long enough for a restart to shorten it visibly.
const FIRST_PAGE = 2500;

const LATER_PAGE = 7500;

const READ_SO_FAR = FIRST_PAGE + LATER_PAGE;

const PLAYLIST_ROWS = READ_SO_FAR + 2000;

// Past every row read so far, so the changes route names a position the client
// holds no path against yet.
const CHANGED_ROW = READ_SO_FAR + 1000;

const PATCHED_PAST_THE_PREFIX = "Retagged past the prefix";

// The first row, which the client holds a path for from the first page on and
// which stays mounted with no scrolling, so the assertion below waits on the
// playlist rather than on a list still moving.
const ROW_IN_THE_PREFIX = 0;

const PATCHED_INSIDE_THE_PREFIX = "Retagged inside the prefix";

// The playlist `librarySize` fills, and the only one long enough to be read in
// pages.
const LONG = { id: "p7", title: "Library" };

const PAGE_READ = /^\/api\/playlists\/[^/]+\/items$/;

// Every page of a playlist but the first, answered by the player and then held,
// so the load can be left part way through at a known row. A page let through
// later carries what the player held when it was asked rather than what an edit
// made since left behind.
const holdThePages = async (page: Page) => {
	const held = new Map<number, () => void>();
	let freely = false;

	const release = (offset: number) => {
		held.get(offset)?.();
		held.delete(offset);
	};

	await page.route(
		(url) => PAGE_READ.test(url.pathname),
		async (route) => {
			const request = route.request();
			const offset = Number(new URL(request.url()).searchParams.get("offset"));
			if (freely || offset === 0 || request.method() !== "GET")
				return route.continue();

			const response = await route.fetch();
			const body = await response.body();
			await new Promise<void>((resolve) => held.set(offset, resolve));
			// Reading the playlist again aborts the pages already out, and a request
			// nobody is waiting for can no longer be answered.
			await route.fulfill({ response, body }).catch(() => {});
		},
	);

	return {
		letThrough: async (offset: number) => {
			await expect
				.poll(() => held.has(offset), {
					message: `no page of the playlist was read at offset ${offset}`,
				})
				.toBe(true);
			release(offset);
		},
		letTheRestThrough: () => {
			freely = true;
			for (const offset of [...held.keys()]) release(offset);
		},
	};
};

// How many rows the list says it has, which is what a screen reader announces
// and what the scrollbar is drawn from.
const rowCount = (page: Page) =>
	page.getByRole("grid").getAttribute("aria-rowcount");

const expectRowCount = (page: Page, rows: number) =>
	expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", String(rows));

// What a given row says, counted rather than asserted on, so `expectSettlesAt`
// can read it: a row that is not there answers zero instead of throwing.
const rowsSaying = (page: Page, at: number, title: string) =>
	trackRow(page, at).filter({ hasText: title }).count();

const firstPageReads = (player: FakePlayer, guid: string) =>
	wholeRowReads(player, guid).filter(
		(path) => new URLSearchParams(path.split("?")[1]).get("offset") === "0",
	);

// Measured rather than assumed: the row is a different height on a phone, and in
// album layout it sits under a cover.
const rowHeightOf = async (page: Page) => {
	const box = await trackRow(page, 0).boundingBox();
	expect(
		box,
		"the first row has to be on screen to be measured",
	).not.toBeNull();
	return box?.height ?? 0;
};

test.describe("with a playlist longer than the pages it arrives in", () => {
	test.use({ librarySize: PLAYLIST_ROWS });

	test("patches a row changed past the rows read so far, rather than starting the playlist again from the top", async ({
		page,
		player,
	}) => {
		const pages = await holdThePages(page);
		await openPlaylistView(page, player, LONG);
		const guid = guidOfPlaylist(player, LONG.id);

		await expectRowCount(page, FIRST_PAGE);
		const rowHeight = await rowHeightOf(page);

		// One more page through and the last one left out, so the list is part read
		// and the row about to change is past everything it holds.
		await pages.letThrough(FIRST_PAGE);
		await expectRowCount(page, READ_SO_FAR);

		player.playItem(LONG.id, CHANGED_ROW);
		player.retagPlaying({ "%title%": PATCHED_PAST_THE_PREFIX });
		await expect
			.poll(() => changeReads(player, guid).length)
			.toBeGreaterThan(0);

		await expectSettlesAt(player, () => rowCount(page), String(READ_SO_FAR));
		await expectSettlesAt(player, () => firstPageReads(player, guid).length, 1);

		pages.letTheRestThrough();
		await expectRowCount(page, PLAYLIST_ROWS);
		await scrollTo(page, rowHeight * CHANGED_ROW);
		await scrollUntilMounted(page, trackRow(page, CHANGED_ROW));
		await expect(trackRow(page, CHANGED_ROW)).toContainText(
			PATCHED_PAST_THE_PREFIX,
		);
	});

	// The case above changes a row past everything the client holds, so its new
	// value has to wait for the load. This one changes a row the client already
	// has, which can be patched straight in while the pages after it are still
	// arriving, and those pages are published from rows read before the patch. So
	// the value can be right and then wrong again, and what is asserted is what
	// the row says once the whole playlist is in rather than what it said on the
	// way.
	test("a row changed inside the rows already read keeps its new value once the rest of the playlist arrives", async ({
		page,
		player,
	}) => {
		const pages = await holdThePages(page);
		await openPlaylistView(page, player, LONG);
		const guid = guidOfPlaylist(player, LONG.id);

		await expectRowCount(page, FIRST_PAGE);

		const ticks = ticksTaken(player);
		player.playItem(LONG.id, ROW_IN_THE_PREFIX);
		player.retagPlaying({ "%title%": PATCHED_INSIDE_THE_PREFIX });

		// Two whole polls with the later pages still held, so the tick carrying the
		// edit was spent while the playlist had nothing but its first page. The row
		// count says the hold held for both of them.
		await expect.poll(() => ticksTaken(player)).toBeGreaterThan(ticks + 1);
		await expectRowCount(page, FIRST_PAGE);

		pages.letTheRestThrough();
		await expectRowCount(page, PLAYLIST_ROWS);

		await expectSettlesAt(
			player,
			() => rowsSaying(page, ROW_IN_THE_PREFIX, PATCHED_INSIDE_THE_PREFIX),
			1,
		);
		// And the value is there because the row was patched, not because the
		// playlist was read again from the top.
		await expectSettlesAt(player, () => firstPageReads(player, guid).length, 1);
	});
});

// The status the component answers when the revision asked about has fallen out
// of its window, which is one of the two the client reads the playlist whole
// again on.
const REVISION_GONE = 410;

// The first page of the reload, answered by the player and then held, so an edit
// made while it waits is one the rows it will arrive carrying know nothing
// about. Held after the answer rather than on its way out: a request stopped
// before it reaches the player comes back carrying the edit, and then there is
// nothing for the client to have missed.
const holdTheReloadsFirstPage = async (page: Page, guid: string) => {
	let taken = false;
	let answered = () => {};
	let release = () => {};
	const onTheWire = new Promise<void>((resolve) => {
		answered = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});

	await page.route(
		(url) => url.pathname === `/api/playlists/${guid}/items`,
		async (route) => {
			const request = route.request();
			const offset = new URL(request.url()).searchParams.get("offset");
			if (taken || offset !== "0" || request.method() !== "GET")
				return route.continue();
			taken = true;

			const response = await route.fetch();
			const body = await response.body();
			answered();
			await held;
			await route.fulfill({ response, body }).catch(() => {});
		},
	);

	return { onTheWire, release: () => release() };
};

const PATCHED_DURING_THE_RELOAD = "Rotten Apple (during the reload)";

test("shows a row changed at the player while the playlist was being read again", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	const guid = guidOfPlaylist(player, WATCHED.id);
	const firstPage = await holdTheReloadsFirstPage(page, guid);
	await failTheNextChangesRead(page, refuseWith(REVISION_GONE));

	// The edit that sends the client to the changes route, which the refusal turns
	// into a read of the whole playlist.
	await retitleTheFirstRow(page, player);
	await firstPage.onTheWire;

	// A second edit, made with the reload's rows already off the player and the
	// client still waiting for them, and given two whole polls to reach a client
	// that is holding none of the playlist to compare it against.
	const ticks = ticksTaken(player);
	player.retagPlaying({ "%title%": PATCHED_DURING_THE_RELOAD });
	await expect.poll(() => ticksTaken(player)).toBeGreaterThan(ticks + 1);

	firstPage.release();

	await expectSettlesAt(
		player,
		() => rowsSaying(page, 0, PATCHED_DURING_THE_RELOAD),
		1,
	);
});

test("follows a row's cover address when its file moves at the player", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	await expect.poll(() => coverAsks(player)).toContain(MOVED_FROM);

	await editTheFirstRow(page, player, {
		"%album%": MOVED.album,
		"%album artist%": MOVED.albumArtist,
		"%path%": MOVED.path,
	});

	await expect.poll(() => coverAsks(player)).toContain(MOVED.cover);
});

// An edit made at the player with Jean left alone, and the single tick it is
// allowed to reach the client on. `stillShows` is read with the edit made and
// the poll refused since, so it is the screen of a client that has asked and
// been told nothing.
const editedAtThePlayer = async (
	page: Page,
	edit: () => void,
	stillShows: () => Promise<void>,
) => {
	const poll = await holdThePoll(page);
	edit();
	await poll.untilRefusedAgain();
	await stillShows();
	poll.letOneThrough();
};

// A row copied in from another playlist, one of the ways a person adds tracks in
// foobar2000. Its title is one `WATCHED` does not already carry, so the row that
// appears cannot be one of its own read twice.
const ADDED = { from: ALSO_HELD.id, index: 0, title: "Tautou" };

// The row below the one removed, which is what a person is left looking at.
const EXPOSED_BY_REMOVAL = "Nutshell";

const RENAMED = "Saturday night";

test("shows a row added at the player within one poll", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	await expect(rowByTitle(page, ADDED.title)).toHaveCount(0);

	await editedAtThePlayer(
		page,
		() => {
			expect(player.copyItems(ADDED.from, WATCHED.id, [ADDED.index])).toBe(
				true,
			);
		},
		() => expect(rowByTitle(page, ADDED.title)).toHaveCount(0),
	);

	await expect(rowByTitle(page, ADDED.title)).toBeVisible();
});

test("shows a row removed at the player within one poll", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	await expect(trackRow(page, 0)).toContainText(WATCHED.first);

	await editedAtThePlayer(
		page,
		() => {
			expect(player.removeItems(WATCHED.id, [0])).toBe(true);
		},
		() => expect(trackRow(page, 0)).toContainText(WATCHED.first),
	);

	await expect(trackRow(page, 0)).toContainText(EXPOSED_BY_REMOVAL);
	await expect(rowByTitle(page, WATCHED.first)).toHaveCount(0);
});

test("shows rows reordered at the player within one poll", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	await expect(trackRow(page, 0)).toContainText(WATCHED.first);

	await editedAtThePlayer(
		page,
		() => {
			expect(player.sortItems(WATCHED.id, { by: "%title%" })).toBe(true);
		},
		() => expect(trackRow(page, 0)).toContainText(WATCHED.first),
	);

	await expect(trackRow(page, 0)).toContainText(SORTED_FIRST);
	await expect(trackRow(page, 3)).toContainText(SORTED_LAST);
});

test("shows the open playlist renamed at the player within one poll", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);

	await editedAtThePlayer(
		page,
		() => {
			expect(player.renamePlaylist(WATCHED.id, RENAMED)).toBe(true);
		},
		() =>
			expect(
				page.getByRole("heading", { level: 1, name: WATCHED.title }),
			).toBeVisible(),
	);

	await expect(
		page.getByRole("heading", { level: 1, name: RENAMED }),
	).toBeVisible();
});

// Either control, since what is asserted is the value rather than whether it can
// be written: `Stars` is an `img` and `StarsInput` is a `group`.
const ratingOf = (page: Page, row: number) =>
	trackRow(page, row)
		.getByRole("img", { name: /stars|Unrated/ })
		.or(trackRow(page, row).getByRole("group", { name: /stars|Unrated/ }));

test.describe("with a rating column drawn on every row", () => {
	// Pinned for the reason `rating.spec.ts` gives: the compact layout draws two
	// optional columns, so a phone otherwise shows a different set from a desktop.
	test.use({ settings: { "jean.columns": ["duration", "rating"] } });

	test("shows a rating written at the player within one poll, without reading the playlist's rows again", async ({
		page,
		player,
	}) => {
		await openPlaylistView(page, player, WATCHED);
		const guid = guidOfPlaylist(player, WATCHED.id);
		await expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated");

		// `retagPlaying` is the fake's only content change that leaves a row where
		// it is, so the row that changes has to be the playing one. Nothing the
		// deadline promises turns on that.
		player.playItem(WATCHED.id, 0);
		await expect(statusBar(page)).toContainText(WATCHED.first);
		player.requests.length = 0;

		await editedAtThePlayer(
			page,
			() => {
				player.retagPlaying({ "%rating%": "4" });
			},
			() => expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated"),
		);

		await expect(ratingOf(page, 0)).toHaveAccessibleName("4 of 5 stars");
		expect(changeReads(player, guid).length).toBeGreaterThan(0);
		await expectSettlesAt(player, () => wholeRowReads(player, guid), []);
	});
});

// beefweb's own address for playing a row, which the component's route replaced.
const BEEFWEB_PLAY = /^\/api\/player\/play\/[^/]+\/\d+$/;

const beefwebPlays = (player: FakePlayer) =>
	player.requests
		.filter((one) => one.method === "POST" && BEEFWEB_PLAY.test(one.path))
		.map((one) => one.path);

// Not the first row, so a request naming the wrong index plays a different song
// rather than landing on the right one by luck.
const PLAYED_ROW = { row: 2, title: "I Stay Away" };

test("plays a double-clicked row through the component rather than through beefweb", async ({
	page,
	player,
}) => {
	await openPlaylistView(page, player, WATCHED);
	player.requests.length = 0;

	await trackRow(page, PLAYED_ROW.row).dblclick();

	await expect(statusBar(page)).toContainText(PLAYED_ROW.title);
	await expect.poll(() => trackPlayed(player)).toBe(PLAYED_ROW.title);
	await expectSettlesAt(player, () => beefwebPlays(player), []);
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

	// Title and artist both come off `GET /api/queue`. The entry was queued at the
	// desktop, so the panel holds nothing of its own to draw it from.
	const row = queuePanel(page).getByRole("listitem").first();
	await expect(row).toContainText("Soy Rock");
	await expect(row).toContainText("Babasónicos");
});

test("takes no player state off beefweb, and asks nobody for a track's columns", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
	player.playItem("p7", 1);
	await expect(statusBar(page)).toContainText("Fizz");

	// Any read at all is a second source of player state whatever it asks for: a
	// stall check wanting `playbackState` alone is one, and so is `GET /api/player`,
	// which asks for nothing.
	await expectSettlesAt(
		player,
		() =>
			player.requests.filter(readsPlayerStateOffBeefweb).map((one) => one.path),
		[],
	);

	expect(requestsTo(player, "trcolumns=").map((one) => one.path)).toEqual([]);

	// The subscription is gone rather than narrowed, and takes the playlist list with it: nothing
	// here reaches beefweb's stream at all.
	expect(requestsTo(player, SUBSCRIPTION)).toEqual([]);
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

// The three below only mean anything together. Jean names the set it is playing
// from by joining the place on the tick to a playlist it holds, and the other
// two are the two states it cannot name one in: the tick carries no place at
// all, and the tick carries a place Jean holds no playlist for. Either on its
// own is satisfied by drawing no name ever, so the first one is what says the
// join still works.
test("names the set a track is playing from", async ({ page, player }) => {
	await playTheTopOfAllMusic(page, player);

	await expectPlayingFrom(page, "All music");

	await openSidebar(page);
	await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(1);
});

test('draws no "Playing from" where the tick carries no place at all, rather than an empty one', async ({
	page,
	player,
}) => {
	player.fooJean.knowsPlayingLocation = false;

	await playTheTopOfAllMusic(page, player);

	await expectNoPlayingFrom(page, player);
});

test('draws no "Playing from" where the tick names a playlist Jean holds none for, rather than an empty one', async ({
	page,
	player,
}) => {
	// The other state, and the one the join is written for: a place is reported
	// but the list Jean joins it against has not caught up to it yet.
	player.fooJean.annotatesEveryPlaylist = false;

	await playTheTopOfAllMusic(page, player);

	const { playlistId, index } = player.player.activeItem;
	expect(
		index,
		"the player reports where it is playing from",
	).toBeGreaterThanOrEqual(0);
	expect(
		playlistId,
		"and it is playing from the playlist left out of the annotations",
	).toBe(player.playlists.at(-1)?.id);

	await expectNoPlayingFrom(page, player);
});

test("a playlist created and played from before the client's list has caught up with the revision turns the wheel once, not twice", async ({
	page,
	player,
	isMobile,
}) => {
	test.skip(!isMobile, "the wheel is the phone's skip gesture");

	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await openNowPlaying(page);
	await expect(currentSlot(page)).toHaveAttribute("data-artwork", "ok");
	expect(await detents(page)).toBe(0);

	// Driven at the desktop rather than through Jean's own "play a set", so the
	// screen stays open and the wheel's own turn count survives: a fresh
	// playlist, created and played from in the same beat, is what the client's
	// list has to catch up on. `addPlaylist` is what moves the playlists
	// revision and so is what fires the list's own refetch.
	const created = player.addPlaylist("Late arrival");
	const playlist = player.playlistById(created.id);
	if (!playlist) throw new Error(`${created.id} did not come back playable`);
	const track = player.libraryTracks[10];
	playlist.items.push(track);

	// Held after the playlist exists, so the tick can already name it while the
	// list the lookup reads still predates it.
	await page.request.post("/__control/latency", { data: { ms: 1500 } });
	player.playItem(created.id, 0);

	// The tick has already moved: the screen names the new track. The list has
	// not, so the wheel must still be exactly where it was rather than having
	// turned on a lookup that answered "resolved and absent".
	await expect(nowPlayingScreen(page)).toContainText(String(track["%title%"]));
	expect(await detents(page)).toBe(0);

	// One track change, one turn, once the list catches up.
	await expect
		.poll(() => detents(page), { message: "one track change, one turn" })
		.toBe(-1);

	await page.request.post("/__control/latency", { data: { ms: 0 } });
});

test('a playlist created elsewhere does not blank "Playing from" for one already known', async ({
	page,
	player,
}) => {
	await playTheTopOfAllMusic(page, player);
	await openNowPlaying(page);
	const header = nowPlayingScreen(page).locator("header");
	await expect(header).toContainText("Playing from");
	await expect(header).toContainText("All music");

	// Held after the request is recorded, so the refetch this playlist fires is
	// still in flight when the assertion below runs. Unrelated to the playlist
	// that is playing, which the join already had an answer for before this.
	await page.request.post("/__control/latency", { data: { ms: 1500 } });
	player.addPlaylist("Unrelated");

	await page.waitForTimeout(500);
	await expect(header).toContainText("Playing from");
	await expect(header).toContainText("All music");

	await page.request.post("/__control/latency", { data: { ms: 0 } });
});

test("the front door still opens once a slow playlist join settles", async ({
	page,
	player,
}) => {
	await openLibrary(page);
	await trackRow(page, PLAYING_ROW.row).dblclick();
	await expect(statusBar(page)).toContainText(PLAYING_ROW.title);

	await page.request.post("/__control/latency", { data: { ms: 1500 } });
	await page.goto("/");

	await page.waitForTimeout(500);
	await expect(nowPlayingScreen(page)).toBeHidden();

	await expect(nowPlayingScreen(page)).toBeVisible({ timeout: 5_000 });

	await page.request.post("/__control/latency", { data: { ms: 0 } });
});

// The three below drive the player over a page with no list on it, so the cover each names is the
// playing surface's own. The Default Playlist is one record's first four tracks and is the same
// four rows All music opens on, so the titles above still name them.
test("the status bar asks for the playing cover at the record's address, with no playlist row in it", async ({
	page,
	player,
}) => {
	await withNoListOnScreen(page);
	await playAtThePlayer(page, player, ONE_RECORD, 0);
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);

	// The sleeve drew, so the absences below are absences rather than a cover
	// that never arrived at all.
	await expect(drawnCover(statusBar(page))).toBeVisible();

	// The record's earliest track, which is the address every other view of this
	// record asks at too, so the browser holds one copy for all of them.
	await expectSettlesAt(
		player,
		() => [...new Set(coversFromTheComponent(player))],
		[FIRST_IN_ALBUM_ORDER],
	);

	// No row in any of it. A position outlives no reorder, so an address built
	// from one names whatever file sits there by the time it is asked again.
	expect(coversAskedElsewhere(player)).toEqual([]);
});

test("the now-playing screen asks for that same address, and for no other", async ({
	page,
	player,
}) => {
	await withNoListOnScreen(page);
	await playAtThePlayer(page, player, TWO_RECORDS.id, TWO_RECORDS.first.row);
	await openNowPlaying(page);
	await expect(nowPlayingScreen(page)).toContainText(TWO_RECORDS.first.title);
	await expect(drawnCover(nowPlayingScreen(page))).toBeVisible();
	await expectSettlesAt(
		player,
		() => [...new Set(coversFromTheComponent(player))],
		[TWO_RECORDS.first.cover],
	);
	player.requests.length = 0;

	// Driven at the player, and onto another record rather than another track of
	// this one: a track of the record already on screen costs no request at all,
	// which is the case below and not this one. On a phone the status bar is
	// unmounted while this screen is open, which is what makes the screen the
	// only surface left to ask.
	player.playItem(player.player.activeItem.playlistId, TWO_RECORDS.second.row);
	await expect(nowPlayingScreen(page)).toContainText(TWO_RECORDS.second.title);
	await expect(drawnCover(nowPlayingScreen(page))).toBeVisible();

	// The second record's earliest track, which is a row this playlist holds
	// above the one now playing rather than the row itself. On a phone the wheel
	// draws the row either side as well and each of those carries its own
	// record's address, so what is read here is the address the centre took.
	await expect
		.poll(() => coversFromTheComponent(player))
		.toContain(TWO_RECORDS.second.cover);
	await expectSettlesAt(
		player,
		() =>
			coversFromTheComponent(player).filter(
				(track) => track === TWO_RECORDS.second.own,
			),
		[],
	);
	expect(coversAskedElsewhere(player)).toEqual([]);
});

test("a second track of the same album costs no cover request at all", async ({
	page,
	player,
}) => {
	await withNoListOnScreen(page);
	await playAtThePlayer(page, player, ONE_RECORD, 0);
	await expect(statusBar(page)).toContainText(FIRST_IN_ALL_MUSIC);
	await expect(drawnCover(statusBar(page))).toBeVisible();

	player.playItem(player.player.activeItem.playlistId, SECOND_IN_THE_ALBUM.row);
	await expect(statusBar(page)).toContainText(SECOND_IN_THE_ALBUM.title);
	await expect(drawnCover(statusBar(page))).toBeVisible();

	// One ask reached the player across both tracks. The address does not move
	// when the track does, so whether the second track was answered by the handle
	// Jean already holds or by the copy the browser is keeping for 180 days, it
	// asks the player for nothing -- and that is what the list surfaces get out
	// of one address an album as well.
	await expectSettlesAt(player, () => coversFromTheComponent(player), [
		FIRST_IN_ALBUM_ORDER,
	]);
	expect(coversAskedElsewhere(player)).toEqual([]);
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

	// All three slots showing their picture. The neighbours are not a prefetch:
	// they are live sleeves, and what a swipe is meant to reveal is one that is
	// decoded and composited already.
	await expect(drawnSlots(page)).toHaveCount(3);

	// This is the point the log may be thrown away at, which the centre decides
	// rather than the neighbours. `untilQuiet` waits for the log to go quiet, and
	// the centre's fetch is the one that lags: it goes through
	// `shared/ui/artworkQueue.ts`'s settle gate, while a neighbour's, drawn with
	// no identity, goes straight out. A reset taken on a neighbour's sleeve lands
	// while the centre's first fetch is still out and counts it below as a second.
	await untilQuiet(player);
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
	// The value, not the address: which of the two a track the media library does
	// not hold is named by is `rating-writes.spec.ts`'s question. What this case
	// needs of it is only that the player can resolve it back to this track, and
	// the reload below is what says it did.
	expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "4" } });

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
