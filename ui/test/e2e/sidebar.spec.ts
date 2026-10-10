import { en } from "../../src/shared/i18n/en.ts";
import type { RecordedRequest } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	closeSidebar,
	dragFrom,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	inSequence,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	playedFrom,
	playRequests,
	pressAndHold,
	refusePlaylistWrites,
	requestsTo,
	scratchOf,
	scrollUntilMounted,
	searchFor,
	sidebar,
	statusBar,
	test,
	titlesIn,
	touchDrag,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";

const DEFAULT_PLAYLIST = "Default Playlist";
const LIBRARY = "Library";
const FAVORITES = "Favorites";
const SPANISH = "Rock en Español";
const SHELF = "Most played";
// An autoplaylist; `useAddTracks.ts`'s top comment has what a lock on it means for a write.
const AUTO = "Recently Added";

// Rows are direct children of the nav; so is the section header, hence the
// filter. The drop target, the drag gesture and the grip all live on the row
// rather than on the button inside it.
//
// Matched on the label's own text rather than on the row's, because two
// playlists may share a substring and `Library` is inside `#Jean Library`. A
// substring that happens to be unique in one fixture is not an address.
const row = (page: Page, title: string) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(title, { exact: true }) });
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
		.filter((one) => one.path.startsWith("/api/queue") && one.method !== "GET")
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

// How far an anchored menu may sit from the control that opened it: room for the popover's own
// offset and a flip at the window's edge, far short of a menu centred in the window.
const ANCHOR_GAP_PX = 48;

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
	test("opens a playlist at its GUID", async ({ page }) => {
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

// `#Jean Library` in the fixture is the user's own: a playlist somebody made and
// happened to title with Jean's prefix. The component gives it no role, and it
// gives its own scratch one whatever that is called, so a title the two can
// share is no way to tell them apart.
test.describe("the scratch playlist among the user's own", () => {
	const JEAN_TITLED = "#Jean Library";

	test("hides the scratch by its role and shows a user's own playlist titled #Jean", async ({
		page,
		player,
	}) => {
		await playAShelf(page);
		const scratchTitle = scratchOf(player)!.title;
		await openSidebar(page);

		await expect(link(page, JEAN_TITLED)).toBeVisible();
		await expect(row(page, scratchTitle)).toHaveCount(0);
	});
});

const newPlaylistButton = (page: Page) =>
	page.getByRole("button", { name: "New playlist" });

// Exact, since a name query matches a substring and "Playlist" is inside "Autoplaylist".
const menuEntry = (page: Page, name: string) =>
	page.getByRole("menuitem", { name, exact: true });

const creates = (player: FakePlayer) =>
	player.requests
		.filter(
			(one) =>
				one.method === "POST" &&
				(one.path === "/api/playlists" || one.path === "/api/autoplaylists"),
		)
		.map((one) => one.path);

// foo_jean answers `canCreateAutoPlaylists` only where it may write playlists and has room
// for an autoplaylist, so `maxAutoPlaylists` is the switch between the two ways in.
const WITHOUT_AUTOPLAYLISTS = { maxAutoPlaylists: 0 };
const WITH_AUTOPLAYLISTS = { maxAutoPlaylists: 100 };

// Everything a plain playlist is promised, asked for both ways in: the + alone where there is
// nothing else to offer, and the menu's Playlist where there is. The second has to do exactly
// what the first does.
const WAYS_IN = [
	{
		how: "the + alone, where no autoplaylist can be made",
		fooJean: WITHOUT_AUTOPLAYLISTS,
		newPlaylist: (page: Page) => newPlaylistButton(page).click(),
	},
	{
		how: "the menu's Playlist, where an autoplaylist can be made too",
		fooJean: WITH_AUTOPLAYLISTS,
		newPlaylist: async (page: Page) => {
			await newPlaylistButton(page).click();
			await menuEntry(page, "Playlist").click();
		},
	},
];

for (const { how, fooJean, newPlaylist } of WAYS_IN) {
	test.describe(`creating a playlist through ${how}`, () => {
		test.use({ fooJean });

		test("makes one and drops it straight into rename", async ({
			page,
			player,
		}) => {
			await openApp(page);
			await newPlaylist(page);

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
			await newPlaylist(page);

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

			await newPlaylist(page);

			const field = page.getByRole("textbox", { name: "Rename New playlist" });
			await expect(field).toBeFocused({ timeout: AT_ONCE_MS });

			// A field that cannot be committed from is not rename mode. The row has no id
			// of the player's yet, so the name typed into it has to wait for one.
			await field.fill("Road trip");
			await page.keyboard.press("Enter");
			await expect.poll(() => titlesInOrder(player)).toContain("Road trip");
		});

		test("a second one does not take the same name", async ({
			page,
			player,
		}) => {
			await openApp(page);

			await newPlaylist(page);
			await expect(
				page.getByRole("textbox", { name: "Rename New playlist" }),
			).toBeFocused();

			await newPlaylist(page);

			await expect
				.poll(() => titlesInOrder(player))
				.toContain("New playlist 2");
		});

		// A browser defines `crypto.randomUUID` only in a secure context, and a player
		// on the LAN serves Jean over plain HTTP. The suite runs on localhost, which
		// the browser counts as secure, so the page has to lose it by hand.
		test("works on a page served over plain HTTP", async ({ page, player }) => {
			await page.addInitScript(() => {
				Reflect.deleteProperty(Crypto.prototype, "randomUUID");
			});
			await openApp(page);
			await newPlaylist(page);

			await expect(
				page.getByRole("textbox", { name: "Rename New playlist" }),
			).toBeFocused();
			await expect.poll(() => titlesInOrder(player)).toContain("New playlist");
		});
	});
}

// Every menu that was ever drawn, by the entries it offered. A menu that opened and closed
// again before an assertion looked would pass a query for its absence.
const recordMenus = (page: Page) =>
	page.addInitScript(() => {
		const seen: string[][] = [];
		Object.assign(window, { menusDrawn: seen });
		new MutationObserver(() => {
			for (const menu of document.querySelectorAll('[role="menu"]')) {
				if (menu.hasAttribute("data-recorded")) continue;
				menu.setAttribute("data-recorded", "");
				seen.push(
					[...menu.querySelectorAll('[role="menuitem"]')].map(
						(item) => item.textContent?.trim() ?? "",
					),
				);
			}
		}).observe(document, { childList: true, subtree: true });
	});

const menusDrawn = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { menusDrawn: string[][] }).menusDrawn,
	);

test.describe("the + where only a plain playlist can be made", () => {
	test.use({ fooJean: WITHOUT_AUTOPLAYLISTS });

	test("creates at once and never offers a one-entry menu", async ({
		page,
		player,
	}) => {
		await recordMenus(page);
		await openApp(page);
		await newPlaylistButton(page).click();

		await expect(
			page.getByRole("textbox", { name: "Rename New playlist" }),
		).toBeFocused();
		await expectSettlesAt(player, () => creates(player), ["/api/playlists"]);
		expect(await menusDrawn(page)).toEqual([]);
	});
});

test.describe("the + where an autoplaylist can be made too", () => {
	test.use({ fooJean: WITH_AUTOPLAYLISTS });

	test("offers Playlist and Autoplaylist, beside the + on a desktop and as an action sheet on a phone, and makes nothing until one is chosen", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		const titlesBefore = titlesInOrder(player);
		await newPlaylistButton(page).click();

		const offered = page
			.getByRole("menu")
			.filter({ has: menuEntry(page, "Autoplaylist") });
		await expect(offered).toBeVisible();
		await expect(offered.getByRole("menuitem")).toHaveCount(2);
		await expect(menuEntry(page, "Playlist")).toBeVisible();
		await expect(menuEntry(page, "Autoplaylist")).toBeVisible();

		const sheet = page
			.getByRole("dialog")
			.filter({ has: menuEntry(page, "Autoplaylist") });
		if (isMobile) {
			await expect(sheet).toBeVisible();
		} else {
			await expect(sheet).toHaveCount(0);
			// Anchored: a menu drawn in the middle of the window, away from what opened it, is
			// a dialog in all but name.
			const button = (await newPlaylistButton(page).boundingBox())!;
			const menu = (await offered.boundingBox())!;
			const gapAcross = Math.max(
				0,
				menu.x - (button.x + button.width),
				button.x - (menu.x + menu.width),
			);
			const gapDown = Math.max(
				0,
				menu.y - (button.y + button.height),
				button.y - (menu.y + menu.height),
			);
			expect(Math.max(gapAcross, gapDown)).toBeLessThanOrEqual(ANCHOR_GAP_PX);
		}

		await expectSettlesAt(player, () => creates(player), []);
		expect(titlesInOrder(player)).toEqual(titlesBefore);
	});

	test("Autoplaylist opens the New autoplaylist dialog, and Escape shuts it having made nothing", async ({
		page,
		player,
	}) => {
		await openApp(page);
		const titlesBefore = titlesInOrder(player);
		await newPlaylistButton(page).click();
		await menuEntry(page, "Autoplaylist").click();

		const dialog = page.getByRole("dialog", { name: "New autoplaylist" });
		await expect(dialog).toBeVisible();
		await expect(page.getByRole("menu")).toHaveCount(0);
		// Still open once everything has settled, so the absence below is the Escape's doing and
		// not a dialog that shut by itself.
		await untilQuiet(player);
		await expect(dialog).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);

		await expectSettlesAt(player, () => creates(player), []);
		expect(titlesInOrder(player)).toEqual(titlesBefore);
	});
});

test.describe("Edit autoplaylist in a playlist's menu (criteria 29 and 37)", () => {
	// Favorites is an autoplaylist Jean made, Rock en Español one Jean keeps for a purpose of its
	// own, and Recently Added one foobar2000 made. Default Playlist stays plain.
	test.use({
		fooJean: {
			...WITH_AUTOPLAYLISTS,
			autoPlaylistSpecs: {
				p2: { key: "", query: 'genre IS "Grunge"', sort: "", forceSort: false },
				p5: {
					key: "folder:x",
					query: 'artist IS "Babasónicos"',
					sort: "",
					forceSort: false,
				},
			},
		},
	});

	const EDIT = "Edit autoplaylist";

	const OFFERED = [
		{ what: "one Jean made", title: FAVORITES, query: 'genre IS "Grunge"' },
		{ what: "one foobar2000 made", title: AUTO, query: "" },
	];
	for (const { what, title, query } of OFFERED) {
		test(`an autoplaylist ${what} offers it, and it opens the Edit autoplaylist dialog on that playlist`, async ({
			page,
			isMobile,
		}) => {
			await openApp(page);
			await menuFor(page, title, isMobile);
			await menuEntry(page, EDIT).click();

			const dialog = page.getByRole("dialog", { name: EDIT });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
				title,
			);
			await expect(dialog.getByRole("combobox", { name: "Query" })).toHaveValue(
				query,
			);
		});
	}

	const WITHHELD = [
		{ what: "an autoplaylist Jean keeps for itself", title: SPANISH },
		{ what: "a plain playlist", title: DEFAULT_PLAYLIST },
	];
	for (const { what, title } of WITHHELD) {
		test(`${what} does not offer it`, async ({ page, isMobile }) => {
			await openApp(page);
			await menuFor(page, title, isMobile);

			await expect(menuEntry(page, "Delete")).toBeVisible();
			expect(await menuEntry(page, EDIT).count()).toBe(0);
		});
	}
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

	test("Home stays first, and the search sits below the pages", async ({
		page,
	}) => {
		await openApp(page);
		await searchFor(page, "babasonicos");
		await openSidebar(page);

		const labels = await sidebar(page)
			.locator("[data-nav-row]")
			.allInnerTexts();
		expect(labels[0]).toContain("Home");
		expect(labels.findIndex((label) => label.includes("babasonicos"))).toBe(
			labels.findIndex((label) => label.includes("Genres")) + 1,
		);
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

// Searching is a filter over what is already held: no playlist is made and nothing is written. Drawn
// among the playlists it would promise to persist the way they do, so it is filed under a heading of
// its own. What sits under the Playlists heading, top to bottom, as a reader sees it.
const listedUnderPlaylists = (page: Page) =>
	sidebar(page).evaluate((nav) => {
		const heading = Array.from(nav.querySelectorAll("p")).find((line) =>
			line.textContent?.startsWith("Playlists"),
		);
		if (!heading) return null;
		const below = heading.getBoundingClientRect().bottom;
		return Array.from(nav.querySelectorAll("button"))
			.filter((button) => button.getBoundingClientRect().top >= below)
			.map((button) => button.innerText.trim().split("\n")[0])
			.filter(Boolean);
	});

const playlistCreates = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path === "/api/playlists",
	);

test.describe("a search in the sidebar", () => {
	const QUERY = "babasonicos";

	test("is filed under Search and never among the playlists, even once something plays from it", async ({
		page,
		player,
	}) => {
		await openApp(page);
		const before = await listedUnderPlaylists(page);
		expect(before, "the sidebar lists the player's playlists").toContain(
			FAVORITES,
		);
		const titles = titlesInOrder(player);

		await searchFor(page, QUERY);
		await openSidebar(page);
		await expect(link(page, QUERY)).toBeVisible();
		expect(await listedUnderPlaylists(page)).toEqual(before);

		await closeSidebar(page);
		await trackRow(page, 0).dblclick();
		await expect.poll(() => scratchOf(player)).toBeTruthy();
		await openSidebar(page);
		await expect(link(page, QUERY)).toBeVisible();
		expect(await listedUnderPlaylists(page)).toEqual(before);

		// Playing materialised the results into the component's own scratch, and nothing else.
		await expectSettlesAt(player, () => playlistCreates(player), []);
		expect(
			titlesInOrder(player).filter(
				(title) => title !== scratchOf(player)?.title,
			),
		).toEqual(titles);
	});
});

test.describe("playing from the sidebar", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"a double tap is two taps, and there is no key to press",
	);

	const guidOf = (player: FakePlayer, title: string) =>
		player.playlists.find((entry) => entry.title === title)!.guid;

	test("double-clicking a playlist opens it and plays it from the top", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await link(page, FAVORITES).dblclick();

		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();
		await expect
			.poll(() => playedFrom(player))
			.toEqual({ id: guidOf(player, FAVORITES), index: 0 });
	});

	test("p on a focused row plays that row and nothing else", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await link(page, FAVORITES).focus();
		await page.keyboard.press("p");

		await expect
			.poll(() => playedFrom(player))
			.toEqual({ id: guidOf(player, FAVORITES), index: 0 });
		await expectSettlesAt(player, () => playRequests(player).length, 1);
	});

	test("a page is not something to play", async ({ page, player }) => {
		await openApp(page);
		await link(page, "Home").dblclick();
		await link(page, "Genres").dblclick();

		await expectSettlesAt(player, () => playRequests(player), []);
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

		await expect(page.getByRole("status")).not.toBeEmpty();
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

		await expect(page.getByRole("status")).not.toBeEmpty();
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

		await expect(page.getByRole("status")).not.toBeEmpty();
		await expect.poll(() => playlistsDrawn(page)).toEqual(PLAYLIST_TITLES);
		expect(titlesInOrder(player).slice(0, 2)).toEqual([
			DEFAULT_PLAYLIST,
			LIBRARY,
		]);
	});

	// A refusal is allowed to take its time: `PATIENT_TIMEOUT_MS` in `client.ts`
	// leaves a playlist write in the air for thirty-five seconds, and every poll
	// inside that window can bring news of somebody working at the player. So the
	// list a rollback puts back is not the list on screen, and putting the whole
	// of it back throws that news away.
	const RENAMED_AT_THE_PLAYER = "Cumbia";
	const RENAMED_AFTERWARDS = "Boleros";

	// `POST /api/playlists/{guid}` is the rename, and the write this case has to
	// catch in flight rather than after it has been answered.
	const renamesAsked = (player: FakePlayer) =>
		player.requests.filter(
			(one) =>
				one.method === "POST" && /^\/api\/playlists\/[^/]+$/.test(one.path),
		).length;

	const releaseThePlayer = (page: Page) =>
		page.request.post("/__control/latency", { data: { ms: 0 } });

	// Renames a playlist in Jean against a component that will refuse it, holds
	// the refusal, and moves the list at the player while it is held. Returns with
	// the poll's answer on screen and the refusal still travelling.
	const refuseSlowlyWhileTheListMoves = async (
		page: Page,
		player: FakePlayer,
		isMobile: boolean,
	) => {
		await openApp(page);
		await refusePlaylistWrites(page);
		await holdThePlayer(page);

		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();
		await page
			.getByRole("textbox", { name: `Rename ${FAVORITES}` })
			.fill("Bangers");
		await page.keyboard.press("Enter");

		// Let go the moment the component has the write, so the polls that follow
		// are answered at once and land ahead of the refusal.
		await expect.poll(() => renamesAsked(player)).toBe(1);
		await releaseThePlayer(page);

		player.renamePlaylist(idOf(player, SPANISH), RENAMED_AT_THE_PLAYER);
		await expect(link(page, RENAMED_AT_THE_PLAYER)).toBeVisible();
	};

	test("a refusal landing after a poll keeps the list the poll brought", async ({
		page,
		player,
		isMobile,
	}) => {
		await refuseSlowlyWhileTheListMoves(page, player, isMobile);

		await expect(page.getByRole("status")).not.toBeEmpty();

		// A tick past the refusal, so a sidebar that went back to the list this
		// edit started from has had a poll to notice and put itself right.
		const ticks = ticksTaken(player);
		await expect.poll(() => ticksTaken(player)).toBeGreaterThan(ticks + 1);

		await expect(link(page, RENAMED_AT_THE_PLAYER)).toBeVisible();
		await expect(link(page, SPANISH)).toHaveCount(0);
		await expect(link(page, FAVORITES)).toBeVisible();
	});

	test("the list still catches up with the player after a refusal it skipped rolling back", async ({
		page,
		player,
		isMobile,
	}) => {
		await refuseSlowlyWhileTheListMoves(page, player, isMobile);
		await expect(page.getByRole("status")).not.toBeEmpty();

		// Nothing in Jean asks for the list again, so what the poll says about the
		// revision is the only thing that can bring this rename over.
		player.renamePlaylist(idOf(player, DEFAULT_PLAYLIST), RENAMED_AFTERWARDS);

		await expect(link(page, RENAMED_AFTERWARDS)).toBeVisible();
		await expect(link(page, DEFAULT_PLAYLIST)).toHaveCount(0);
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

		const before = player.playlists.find(
			(entry) => entry.title === DEFAULT_PLAYLIST,
		)!.items.length;
		const target = await dragTrackTo(page, 0, DEFAULT_PLAYLIST);

		// The row arms on an animation frame rather than on the move event, so that
		// a target autoscrolling under a stationary pointer still lights up.
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		const libraryGuid = player.playlists.find(
			(entry) => entry.title === LIBRARY,
		)!.guid;
		const targetGuid = player.playlists.find(
			(entry) => entry.title === DEFAULT_PLAYLIST,
		)!.guid;

		const copyRequests = () =>
			requestsTo(player, "/items/copy").filter(
				(entry) => entry.method === "POST",
			);

		await expectSettlesAt(player, () => copyRequests().length, 1);
		const copy = copyRequests()[0];
		expect(copy.path).toBe(`/api/playlists/${targetGuid}/items/copy`);
		expect(copy.body).toEqual({
			source: libraryGuid,
			runs: [[0, 1]],
			duplicates: "skip",
		});

		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.title === DEFAULT_PLAYLIST)!
						.items.length,
			)
			.toBe(before + 1);

		await expect(page.getByRole("status")).toContainText(DEFAULT_PLAYLIST);
	});

	// Collapsing a selection on pointer-down empties it before the pointer has moved a pixel, and a
	// multi-track drag cannot exist. The decision waits for the release.
	test.describe("pressing inside a selection of several", () => {
		const selected = (page: Page) =>
			page.locator('[role="row"][aria-selected="true"]');

		const selectThree = async (page: Page) => {
			await openApp(page);
			await scrollUntilMounted(page, trackRow(page, 2));
			await trackRow(page, 0).click();
			await trackRow(page, 2).click({ modifiers: ["Shift"] });
			await expect(selected(page)).toHaveCount(3);
		};

		// Read after two frames rather than retried: a collapse lands on the render after the press,
		// and a retrying read taken before it would pass on the way through.
		const selectedOnceDrawn = async (page: Page) => {
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					),
			);
			return selected(page).count();
		};

		const pressOn = async (page: Page, index: number) => {
			const box = await trackRow(page, index).boundingBox();
			await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
			await page.mouse.down();
		};

		test("keeps the whole selection, and drags all of it", async ({
			page,
			player,
		}) => {
			await selectThree(page);
			const before = titlesIn(player, "p1").length;

			await pressOn(page, 1);
			expect(await selectedOnceDrawn(page)).toBe(3);

			const target = row(page, DEFAULT_PLAYLIST);
			const box = await target.boundingBox();
			await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, {
				steps: 16,
			});
			await expect(target).toHaveAttribute("data-drop-over", "true");
			await page.mouse.up();

			await expect(page.getByRole("status")).toContainText(
				`Added 3 tracks to ${DEFAULT_PLAYLIST}`,
			);
			await expectSettlesAt(
				player,
				() => titlesIn(player, "p1").length,
				before + 3,
			);
		});

		test("and a release that did not drag narrows it to the row pressed", async ({
			page,
		}) => {
			await selectThree(page);

			await pressOn(page, 1);
			expect(await selectedOnceDrawn(page)).toBe(3);
			await page.mouse.up();

			await expect(selected(page)).toHaveCount(1);
			await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");
		});
	});

	test("a drop onto a playlist that fills itself says so in the ghost, and sends nothing", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const target = await dragTrackTo(page, 0, AUTO);
		await expect(target).toHaveAttribute("data-drop-over", "true");

		const ghost = page.locator("[data-refused='true']");
		await expect(ghost).toBeVisible();
		await expect(ghost).toHaveText(en["playlist.autoRefuses"]);

		await page.mouse.up();

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/copy").length,
			0,
		);
		await expect(page.getByRole("status")).toBeEmpty();
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

test.describe("dragging the playing track off the status bar", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"drag is mouse-only; touch has the menu",
	);

	test("the playing track dropped on a playlist is copied there from the playlist it plays in", async ({
		page,
		player,
	}) => {
		await openApp(page);
		const before = titlesIn(player, "p2");
		const library = player.playlists.find((entry) => entry.title === LIBRARY)!;
		const index = library.items.findIndex(
			(track) => !before.includes(track["%title%"]),
		);
		const title = String(library.items[index]["%title%"]);
		await scrollUntilMounted(page, trackRow(page, index));
		await trackRow(page, index).dblclick();

		const playing = statusBar(page).getByRole("button", {
			name: "Show current track",
		});
		await expect(playing).toContainText(title);

		const target = row(page, FAVORITES);
		await dragFrom(page, playing, target);
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		const copyRequests = () =>
			requestsTo(player, "/items/copy").filter(
				(entry) => entry.method === "POST",
			);
		await expectSettlesAt(player, () => copyRequests().length, 1);
		expect(copyRequests()[0].body).toEqual({
			source: library.guid,
			runs: [[index, 1]],
			duplicates: "skip",
		});

		await expect.poll(() => titlesIn(player, "p2")).toEqual([...before, title]);
		await expect(page.getByRole("status")).toContainText(FAVORITES);
		await expect(nowPlayingScreen(page)).toBeHidden();
	});
});

test.describe("a playlist deleted at the player while you are looking at it", () => {
	const entryOf = (player: FakePlayer, title: string) => {
		const found = player.playlists.find((one) => one.title === title);
		if (!found) throw new Error(`no playlist ${title}`);
		return found;
	};

	const hashOf = (page: Page) => page.evaluate(() => location.hash);

	test("leaves the address bar naming a playlist that exists", async ({
		page,
		player,
	}) => {
		const gone = entryOf(player, FAVORITES);
		await page.goto(`/#/${gone.guid}`);
		await expect(trackRow(page, 0)).toBeVisible();
		expect(await hashOf(page)).toContain(gone.guid);

		expect(player.removePlaylist(gone.id)).toBe(true);

		await expect.poll(() => hashOf(page)).not.toContain(gone.guid);

		const landed = (await hashOf(page)).replace(/^#\/?/, "");
		expect(player.playlists.some((one) => one.guid === landed)).toBe(true);
	});
});
