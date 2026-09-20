import type { RecordedRequest } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	dragFrom,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	inSequence,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	pressAndHold,
	refusePlaylistWrites,
	requestsTo,
	scrollUntilMounted,
	searchFor,
	sidebar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";

const DEFAULT_PLAYLIST = "Default Playlist";
const LIBRARY = "Library";
const FAVORITES = "Favorites";
const SPANISH = "Rock en Español";
const SHELF = "Most played";
// An autoplaylist, indistinguishable from the rest over the API: it accepts a
// copy with a 204 rather than a 4xx, and adds nothing. See `useAddTracks`.
const AUTO = "Recently Added";

// Rows are direct children of the nav; so is the section header, hence the
// filter. The drop target, the drag gesture and the grip all live on the row
// rather than on the button inside it.
const row = (page: Page, title: string) =>
	sidebar(page).locator("> div").filter({ hasText: title });
const link = (page: Page, title: string) =>
	row(page, title).getByRole("button").first();

const titlesInOrder = (player: FakePlayer) =>
	player.playlists.map((entry) => entry.title);

const openApp = async (page: Page) => {
	await openLibrary(page);
	await openSidebar(page);
};

// Nothing but playback puts the shelf row in the sidebar: it is there for as
// long as a shelf is what is playing. Most played is the tab Explore opens on.
const playAShelf = async (page: Page) => {
	await page.goto("/");
	await page
		.getByRole("region", { name: "Explore" })
		.getByRole("button", { name: /^Jessico/ })
		.click();
	await expectPlayingFrom(page, SHELF);
};

// Right-click on a pointer, press-and-hold on touch: the same menu, asked for
// the way each surface asks for it. Only the hold has an echo to swallow.
const menuFor = async (page: Page, title: string, isMobile: boolean) => {
	const target = row(page, title);
	if (isMobile) await pressAndHold(page, target);
	else await target.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
};

// beefweb's playlist-update stream.
const SUBSCRIPTION = "/api/query/updates";

const GUID_ROUTE =
	/#\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Polls watched with nothing moving at the player. One would not tell a client
// that re-reads the list every tick from one that re-read it on the tick this
// happened to sample.
const TICKS_WATCHED = 3;

const ticksTaken = (player: FakePlayer) =>
	requestsTo(player, "/api/state").filter((one) => one.method === "GET").length;

// Reads of the collection alone. A playlist's rows sit under the same prefix,
// and a spec counting those would never see the list stand still.
const listReads = (player: FakePlayer) =>
	player.requests.filter(
		(one) => one.method === "GET" && one.path === "/api/playlists",
	).length;

// Everything the component was asked about the play queue before a given request
// went out, as method and path, so a failure names the call rather than a number.
const queueAskedBefore = (player: FakePlayer, request: RecordedRequest) =>
	player.requests
		.slice(0, player.requests.indexOf(request))
		.filter((one) => one.path.startsWith("/api/queue"))
		.map((one) => `${one.method} ${one.path}`);

// Anything that would change the queue rather than read it. A read after a delete
// is the player's own news: losing its playlist costs a queued entry the position
// it was published with, which moves the queue revision for every client on the
// network. A write is Jean taking somebody's queue apart.
const queueWrites = (player: FakePlayer) =>
	player.requests
		.filter(
			(one) =>
				one.path.startsWith("/api/queue") &&
				one.method !== "GET" &&
				one.method !== "OPTIONS",
		)
		.map((one) => `${one.method} ${one.path}`);

// The playlists the sidebar draws, in the order it draws them. A reorder Jean made
// on its own shows nowhere else: the player's list has not moved.
const PLAYLIST_TITLES = [DEFAULT_PLAYLIST, LIBRARY, FAVORITES, SPANISH, AUTO];

const playlistsDrawn = async (page: Page) => {
	const rows = await sidebar(page).locator("[data-nav-row]").allTextContents();
	return rows
		.map((text) =>
			PLAYLIST_TITLES.find((title) => text.trim().startsWith(title)),
		)
		.filter((title) => title !== undefined);
};

// Long enough that waiting for the player is the difference between a screen
// somebody can work with and one that is not there yet. A phone at the edge of the
// house is the case: on localhost every answer lands before the next frame, so
// with nothing held an eager screen and a patient one read the same.
const PLAYER_HELD_MS = 6000;
const AT_ONCE_MS = 2000;

const holdThePlayer = (page: Page) =>
	page.request.post("/__control/latency", { data: { ms: PLAYER_HELD_MS } });

const queueRow = async (page: Page, index: number, isMobile: boolean) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	const item = page.getByRole("menuitem", { name: "Add to queue" });
	await expect(item).toBeEnabled();
	await item.click();
	await expect(item).toHaveCount(0);
};

// The fake's own key for a playlist, which is how a spec drives the player from
// outside the app. Found by title, since the address Jean uses is the question
// here.
const idOf = (player: FakePlayer, title: string) =>
	player.playlists.find((entry) => entry.title === title)!.id;

// From home rather than from a playlist route, because which address a playlist
// answers at is what these three cases are about.
const openHome = async (page: Page) => {
	await page.goto("/");
	await openSidebar(page);
	await expect(link(page, FAVORITES)).toBeVisible();
};

test.describe("where the playlist list comes from", () => {
	test("opens a playlist at a GUID rather than at beefweb's playlist id", async ({
		page,
	}) => {
		await openHome(page);
		await link(page, FAVORITES).click();

		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();
		await expect(page).toHaveURL(GUID_ROUTE);

		// The address somebody bookmarks. A route Jean can resolve only while it
		// holds the list it was built from is not an address at all, so coming back
		// to this one cold has to land on the same playlist.
		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();
	});

	test("opens no playlist subscription on beefweb", async ({
		page,
		player,
	}) => {
		await openHome(page);

		// While that stream is open it writes the same list the component's answer
		// does, so a client holding both draws whichever spoke last.
		await expectSettlesAt(
			player,
			() => requestsTo(player, SUBSCRIPTION).length,
			0,
		);
	});

	test("re-reads the list when the playlists revision moves, and not on the polls between", async ({
		page,
		player,
	}) => {
		await openHome(page);
		await expect.poll(() => ticksTaken(player)).toBeGreaterThanOrEqual(2);
		player.requests.length = 0;

		await expect
			.poll(() => ticksTaken(player))
			.toBeGreaterThanOrEqual(TICKS_WATCHED);
		await expectSettlesAt(player, () => listReads(player), 0);

		// Renamed at the player, with nothing done in Jean: the revision on the
		// poll is the only thing that says the list is worth reading again.
		player.renamePlaylist(idOf(player, FAVORITES), "Bangers");

		await expect(link(page, "Bangers")).toBeVisible();
		await expectSettlesAt(player, () => listReads(player), 1);
	});
});

test.describe("creating a playlist", () => {
	test("the + makes one and drops it straight into rename", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await page.getByRole("button", { name: "New playlist" }).click();

		const field = page.getByRole("textbox", { name: "Rename New playlist" });
		await expect(field).toBeFocused();
		await expect(field).toHaveValue("New playlist");

		await expect.poll(() => titlesInOrder(player)).toContain("New playlist");

		await expect(
			page.getByRole("heading", { level: 1, name: LIBRARY }),
		).toBeVisible();
	});

	test("typing a name commits it", async ({ page, player }) => {
		await openApp(page);
		await page.getByRole("button", { name: "New playlist" }).click();

		await page
			.getByRole("textbox", { name: "Rename New playlist" })
			.fill("Road trip");
		await page.keyboard.press("Enter");

		await expect(link(page, "Road trip")).toBeVisible();
		await expect.poll(() => titlesInOrder(player)).toContain("Road trip");
		await expect
			.poll(() => titlesInOrder(player))
			.not.toContain("New playlist");
	});

	test("the row opens in rename mode without waiting for the player", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await holdThePlayer(page);

		await page.getByRole("button", { name: "New playlist" }).click();

		const field = page.getByRole("textbox", { name: "Rename New playlist" });
		await expect(field).toBeFocused({ timeout: AT_ONCE_MS });

		// A field that cannot be committed from is not rename mode. The row has no id
		// of the player's yet, so the name typed into it has to wait for one.
		await field.fill("Road trip");
		await page.keyboard.press("Enter");
		await expect.poll(() => titlesInOrder(player)).toContain("Road trip");
	});

	test("a second one does not take the same name", async ({ page, player }) => {
		await openApp(page);
		const add = page.getByRole("button", { name: "New playlist" });

		await add.click();
		await expect(
			page.getByRole("textbox", { name: "Rename New playlist" }),
		).toBeFocused();

		await add.click();

		await expect.poll(() => titlesInOrder(player)).toContain("New playlist 2");
	});
});

test.describe("renaming a playlist", () => {
	test("the menu renames it in place", async ({ page, player, isMobile }) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();

		await page
			.getByRole("textbox", { name: `Rename ${FAVORITES}` })
			.fill("Bangers");
		await page.keyboard.press("Enter");

		await expect(link(page, "Bangers")).toBeVisible();
		await expect.poll(() => titlesInOrder(player)).toContain("Bangers");
	});

	// The write is held so that the two states can be told apart at all. A sidebar
	// that waits for the component looks identical to one that does not while the
	// answer takes a frame, and looks like a dead row for as long as the answer
	// takes on a link that is having a bad afternoon.
	test("the row carries the new name before the component has answered", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();
		await holdThePlayer(page);

		await page
			.getByRole("textbox", { name: `Rename ${FAVORITES}` })
			.fill("Bangers");
		await page.keyboard.press("Enter");

		await expect(link(page, "Bangers")).toBeVisible({ timeout: AT_ONCE_MS });
		expect(
			titlesInOrder(player),
			"the fake has to hold a playlist write behind /__control/latency",
		).toContain(FAVORITES);
	});

	test("Escape leaves the name alone", async ({ page, player, isMobile }) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();

		const field = page.getByRole("textbox", { name: `Rename ${FAVORITES}` });
		await field.fill("Bangers");
		await field.press("Escape");

		// Escape has to beat the blur that follows it, or cancelling commits.
		await expect(link(page, FAVORITES)).toBeVisible();
		expect(titlesInOrder(player)).toContain(FAVORITES);
		expect(titlesInOrder(player)).not.toContain("Bangers");
	});
});

test.describe("deleting a playlist", () => {
	test("it confirms on a page of its own, and says what survives", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();

		await expect(
			page.getByText("7 tracks stay where they are on disk"),
		).toBeVisible();

		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect(link(page, FAVORITES)).toHaveCount(0);
		await expect.poll(() => titlesInOrder(player)).not.toContain(FAVORITES);
	});

	test("backing out of the confirmation keeps it", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Keep it" }).click();

		await expect(link(page, FAVORITES)).toBeVisible();
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/playlists/").filter(
					(entry) => entry.method === "DELETE",
				).length,
			0,
		);
	});

	// The player keeps playing a queued track whose playlist has gone, so clearing
	// the queue first would throw away something the user asked for to avert
	// nothing. `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, has what
	// foobar2000 actually does with a queued entry whose playlist is deleted.
	test("a track queued out of it stays queued, and the delete asks the queue nothing first", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		const guid = player.playlists.find(
			(entry) => entry.title === FAVORITES,
		)!.guid;
		await link(page, FAVORITES).click();
		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();

		await queueRow(page, 0, isMobile);
		// Settled rather than polled: queueing opens the panel, which reads the queue
		// back, and a read still in flight would land the far side of the clear and
		// be counted against the delete.
		await expectSettlesAt(player, () => player.playQueue.length, 1);
		// Scoped to the panel: on a phone the scrim behind it carries the same name.
		await page
			.getByRole("complementary", { name: "Queue" })
			.getByRole("button", { name: "Close the queue" })
			.click();

		player.requests.length = 0;

		await openSidebar(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect(link(page, FAVORITES)).toHaveCount(0);

		// The guard that went read the queue and emptied it of the playlist before
		// sending any of this, so what it left behind is queue calls ahead of the
		// delete.
		const sent = () =>
			player.requests.find(
				(one) =>
					one.method === "DELETE" && one.path === `/api/playlists/${guid}`,
			);
		await expect.poll(() => sent() !== undefined).toBe(true);
		expect(queueAskedBefore(player, sent()!)).toEqual([]);

		await expectSettlesAt(player, () => queueWrites(player), []);
		expect(player.playQueue).toHaveLength(1);
	});

	test("deleting what you are looking at steps onto the neighbour", async ({
		page,
		isMobile,
	}) => {
		await openApp(page);
		await link(page, FAVORITES).click();
		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();

		await openSidebar(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect(
			page.getByRole("heading", { level: 1, name: SPANISH }),
		).toBeVisible();
	});
});

test.describe("the drawer", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the sidebar is a drawer only on a phone",
	);

	test("the scrim closes it", async ({ page }) => {
		await openApp(page);
		await expect(link(page, LIBRARY)).toBeVisible();

		const scrim = page.getByRole("button", { name: "Close menu" });
		const box = await scrim.boundingBox();
		await scrim.click({ position: { x: box!.width - 8, y: box!.height / 2 } });
		await expect(link(page, LIBRARY)).toBeHidden();
	});

	test("a flick left closes it", async ({ page }) => {
		await openApp(page);
		await expect(link(page, LIBRARY)).toBeVisible();

		const box = (await sidebar(page).boundingBox())!;
		const y = box.y + box.height * 0.6;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.8, y },
			{ x: box.x + box.width * 0.8 - 120, y },
		);

		await expect(link(page, LIBRARY)).toBeHidden();
	});
});

test.describe("beside the now-playing screen", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"on a phone the screen covers both the sidebar and its toggle",
	);

	// The four rows that decide they are current by comparing the shell's route
	// against their own. The three sections hold a literal each; the playing-from
	// row computes one, and it is drawn only while a set that is not a playlist
	// is playing, so it is reached another way.
	const ROUTED_ROWS: {
		label: string;
		reach: (page: Page) => Promise<void>;
	}[] = [
		{ label: "Home", reach: openApp },
		{ label: "All music", reach: openApp },
		{ label: "Genres", reach: openApp },
		{ label: SHELF, reach: playAShelf },
	];

	// The toggle by its place in the top bar, not by its name: the name is what
	// the second test here is about, and `openSidebar` in `fixtures.ts` asks for
	// it by name.
	const toggle = (page: Page) =>
		page.locator("header").first().getByRole("button").first();

	const expectToggleMatchesSidebar = async (page: Page, isShown: boolean) => {
		await expect(
			sidebar(page).getByRole("button", { name: "Home" }),
		).toBeVisible({ visible: isShown });
		// The accessible name, not `aria-expanded`. That attribute already reads
		// the flag the label should have read, so a test on it goes green against
		// a label naming the other one.
		await expect(toggle(page)).toHaveAccessibleName(
			isShown ? "Hide playlists" : "Show playlists",
		);
	};

	test("every sidebar row that reads the route still reads as current with the screen open", async ({
		page,
	}) => {
		// `aria-current` rather than the highlight beside it. Both come off one
		// expression, so an assertion on what the row looks like would pass while
		// the half a screen reader reads stayed dead.
		await inSequence(ROUTED_ROWS, async ({ label, reach }) => {
			await reach(page);
			await openSidebar(page);

			await link(page, label).click();
			await expect(link(page, label)).toHaveAttribute("aria-current", "true");

			await openNowPlaying(page);
			await expect(link(page, label)).toHaveAttribute("aria-current", "true");

			await nowPlayingScreen(page)
				.getByRole("button", { name: "Close now playing" })
				.click();
			await expect(nowPlayingScreen(page)).toBeHidden();
		});
	});

	test("the toggle says Hide playlists while the sidebar is shown and Show playlists while it is not, screen open or shut", async ({
		page,
	}) => {
		await openApp(page);
		await expectToggleMatchesSidebar(page, true);

		await toggle(page).click();
		await expectToggleMatchesSidebar(page, false);

		await openNowPlaying(page);
		await expectToggleMatchesSidebar(page, false);

		await toggle(page).click();
		await expectToggleMatchesSidebar(page, true);
	});
});

// Six rows through three handlers: the four section rows go through one, the
// search row through a second, a playlist through a third.
test.describe("choosing a row while the now-playing screen is open", () => {
	const SEARCHED = "babasonicos";

	// The screen covers the toggle on a phone, deliberately, so Mod+B is the only
	// way into the drawer while the screen is up.
	const revealSidebar = async (page: Page, isMobile: boolean) => {
		if (!isMobile) return openSidebar(page);
		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebar(page)).toBeVisible();
	};

	const CHOICES: {
		what: string;
		label: string;
		route: string;
		routeOf?: (player: FakePlayer) => string;
		heading: string | RegExp;
		setUp?: (page: Page) => Promise<void>;
	}[] = [
		{ what: "Home", label: "Home", route: "home", heading: /of music/ },
		{
			what: "All music",
			label: "All music",
			route: "all",
			heading: "All music",
		},
		{ what: "Genres", label: "Genres", route: "genres", heading: "Genres" },
		{
			what: "the search row",
			label: SEARCHED,
			route: `search/${SEARCHED}`,
			heading: SEARCHED,
			setUp: async (page) => {
				await page.goto("/");
				await searchFor(page, SEARCHED);
			},
		},
		{
			what: "the playing-from row",
			label: SHELF,
			route: "shelf/top",
			heading: SHELF,
			setUp: playAShelf,
		},
		{
			what: "a playlist",
			label: FAVORITES,
			route: "the playlist's own GUID",
			routeOf: (player) =>
				player.playlists.find((entry) => entry.title === FAVORITES)!.guid,
			heading: FAVORITES,
		},
	];

	for (const { what, label, route, routeOf, heading, setUp } of CHOICES) {
		test(`${what} closes the screen and lands on #/${route}, not back on ${LIBRARY}`, async ({
			page,
			player,
			isMobile,
		}) => {
			await setUp?.(page);

			// The screen is opened from Library, which is none of the six
			// destinations. Open it from the row under test instead and a screen that
			// went back to where it was opened from would land on the right route
			// anyway, and the case would prove nothing.
			await openLibrary(page);
			await openNowPlaying(page);
			await revealSidebar(page, isMobile);

			await link(page, label).click();

			await expect(nowPlayingScreen(page)).toBeHidden();
			await expect(page).toHaveURL(
				new RegExp(`#/${routeOf ? routeOf(player) : route}$`),
			);
			await expect(
				page.getByRole("heading", { level: 1, name: heading }),
			).toBeVisible();

			// The drawer is the compact sidebar, and a choice made in it shuts it on
			// the way. On a desktop the column stays where it is.
			if (isMobile) await expect(sidebar(page)).toBeHidden();
		});
	}
});

test.describe("the search entry", () => {
	test("it is not a permanent shelf -- it appears when there is a search", async ({
		page,
	}) => {
		await openApp(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toHaveCount(0);

		await searchFor(page, "babasonicos");

		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toBeVisible();

		await expect(link(page, "babasonicos")).toContainText("12");
	});

	test("it goes back to the results after browsing away", async ({ page }) => {
		await openApp(page);
		await searchFor(page, "babasonicos");

		await openSidebar(page);
		await link(page, SPANISH).click();
		await expect(
			page.getByRole("heading", { level: 1, name: SPANISH }),
		).toBeVisible();

		await openSidebar(page);
		await link(page, "babasonicos").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();
	});
});

// The drags below are mouse-only: on a phone the sidebar is a drawer covering
// the list a track would be dragged from, and the menu is the path instead.
// This describe stays outside that skip, because the trap it guards comes from
// drag machinery bound to every row whichever pointer arrives.
test.describe("opening a playlist", () => {
	test("a plain click still opens the playlist", async ({ page }) => {
		await openApp(page);
		await link(page, DEFAULT_PLAYLIST).click();

		// setPointerCapture retargets the compatibility mousedown and mouseup, and
		// the click is dispatched at their common ancestor -- so capturing on the row
		// up front sends every click to the row rather than to the button, and
		// navigation stops working with no error anywhere.
		await expect(
			page.getByRole("heading", { level: 1, name: DEFAULT_PLAYLIST }),
		).toBeVisible();
	});
});

test.describe("reordering playlists", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"drag is mouse-only; touch has the menu",
	);

	test("dragging one over the row below it moves it there", async ({
		page,
		player,
	}) => {
		await openApp(page);

		const from = await row(page, DEFAULT_PLAYLIST).boundingBox();
		const to = await row(page, LIBRARY).boundingBox();

		await page.mouse.move(
			from!.x + from!.width / 2,
			from!.y + from!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height * 0.75, {
			steps: 12,
		});
		await page.mouse.up();

		const guid = player.playlists.find(
			(entry) => entry.title === DEFAULT_PLAYLIST,
		)!.guid;

		// Position among the player's playlists, not among the visible rows: the two
		// differ the moment Jean's hidden scratch playlist exists.
		await expect
			.poll(() =>
				requestsTo(player, "/move")
					.filter((entry) => entry.method === "POST")
					.map((entry) => entry.path),
			)
			.toEqual([`/api/playlists/${guid}/move`]);
		await expect
			.poll(() => titlesInOrder(player).slice(0, 2))
			.toEqual([LIBRARY, DEFAULT_PLAYLIST]);
	});

	test("a drag does not also open the playlist it started on", async ({
		page,
	}) => {
		await openApp(page);

		const from = await row(page, DEFAULT_PLAYLIST).boundingBox();
		const centre = {
			x: from!.x + from!.width / 2,
			y: from!.y + from!.height / 2,
		};

		await page.mouse.move(centre.x, centre.y);
		await page.mouse.down();
		await page.mouse.move(centre.x, centre.y + from!.height * 1.5, {
			steps: 8,
		});
		await page.mouse.move(centre.x, centre.y, { steps: 8 });
		await page.mouse.up();

		// A drag that starts on a link ends with a click on that link. Two things
		// stop it independently -- the gesture swallows its own click, and pointer
		// capture retargets that click to the row -- so removing either one alone
		// leaves this green.
		await expect(
			page.getByRole("heading", { level: 1, name: LIBRARY }),
		).toBeVisible();
	});

	test("Alt with the arrows does the same from the keyboard", async ({
		page,
		player,
	}) => {
		await openApp(page);

		await link(page, DEFAULT_PLAYLIST).focus();
		await page.keyboard.press("Alt+ArrowDown");

		await expect
			.poll(() => titlesInOrder(player).slice(0, 2))
			.toEqual([LIBRARY, DEFAULT_PLAYLIST]);
	});
});

// Every one of these draws the change before the player has agreed to it, which is
// what makes the sidebar feel like the list rather than a view of it. The price is
// that a refusal has to be taken back on screen, and a sidebar left showing an edit
// the player refused is a lie that survives until the next poll happens to notice.
test.describe("an edit the component refuses", () => {
	test("a rename goes back to the name the player still has", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await refusePlaylistWrites(page);

		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();
		await page
			.getByRole("textbox", { name: `Rename ${FAVORITES}` })
			.fill("Bangers");
		await page.keyboard.press("Enter");

		await expect(page.getByRole("status")).toBeVisible();
		await expect(link(page, FAVORITES)).toBeVisible();
		await expect(link(page, "Bangers")).toHaveCount(0);
		expect(titlesInOrder(player)).toContain(FAVORITES);
	});

	test("a delete puts the playlist back", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await refusePlaylistWrites(page);

		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect(page.getByRole("status")).toBeVisible();
		await expect(link(page, FAVORITES)).toBeVisible();
		expect(titlesInOrder(player)).toContain(FAVORITES);
	});

	test("a reorder puts the row back where it was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "Alt and the arrows are the desktop's way to reorder");

		await openApp(page);
		await refusePlaylistWrites(page);

		await link(page, DEFAULT_PLAYLIST).focus();
		await page.keyboard.press("Alt+ArrowDown");

		await expect(page.getByRole("status")).toBeVisible();
		await expect.poll(() => playlistsDrawn(page)).toEqual(PLAYLIST_TITLES);
		expect(titlesInOrder(player).slice(0, 2)).toEqual([
			DEFAULT_PLAYLIST,
			LIBRARY,
		]);
	});
});

test.describe("dragging tracks onto a playlist", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"drag is mouse-only; touch has the menu",
	);

	const dragTrackTo = async (page: Page, index: number, title: string) => {
		const target = row(page, title);
		await dragFrom(page, trackRow(page, index), target);
		return target;
	};

	test("a track dropped on a playlist is copied into it", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const before = player.playlists.find((entry) => entry.title === FAVORITES)!
			.items.length;
		const target = await dragTrackTo(page, 0, FAVORITES);

		// The row arms on an animation frame rather than on the move event, so that
		// a target autoscrolling under a stationary pointer still lights up.
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		const libraryGuid = player.playlists.find(
			(entry) => entry.title === LIBRARY,
		)!.guid;
		const favoritesGuid = player.playlists.find(
			(entry) => entry.title === FAVORITES,
		)!.guid;

		const copyRequests = () =>
			requestsTo(player, "/items/copy").filter(
				(entry) => entry.method === "POST",
			);

		await expectSettlesAt(player, () => copyRequests().length, 1);
		const copy = copyRequests()[0];
		expect(copy.path).toBe(`/api/playlists/${favoritesGuid}/items/copy`);
		expect(copy.body).toEqual({ source: libraryGuid, runs: [[0, 1]] });

		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.title === FAVORITES)!.items
						.length,
			)
			.toBe(before + 1);

		await expect(page.getByRole("status")).toContainText(FAVORITES);
	});

	test("a playlist that ignores the write is not reported as a copy", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const target = await dragTrackTo(page, 0, AUTO);
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect(page.getByRole("status")).toContainText(
			"Nothing was added to",
		);
		expect(
			player.playlists.find((entry) => entry.title === AUTO)!.items,
		).toHaveLength(5);
	});

	test("a drag that lands nowhere gives the page back", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const target = await dragTrackTo(page, 0, FAVORITES);
		await expect(target).toHaveAttribute("data-drop-over", "true");

		await page.mouse.move(4, 4, { steps: 8 });
		await page.mouse.up();

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/copy").length,
			0,
		);

		await page.getByRole("heading", { level: 1, name: LIBRARY }).dblclick();
		expect(
			await page.evaluate(() => window.getSelection()?.isCollapsed ?? true),
		).toBe(false);
	});

	test("the playlist you are dragging out of is not a target", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const target = await dragTrackTo(page, 0, LIBRARY);

		await expect(target).not.toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/copy").length,
			0,
		);
	});
});
