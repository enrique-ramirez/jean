import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	inSequence,
	listenHere,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	requestsTo,
	scrollTo,
	scrollTop,
	scrollUntilMounted,
	searchField,
	searchFor,
	sidebar,
	sidebarToggle,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";
import { panelTab, playRow, TAGGED } from "./nowPlaying.ts";

// One test per binding in keymap.ts: `useKeymap` registers only the ids a scope
// both declares and has a handler for, so a deleted handler leaves the shortcut
// in the help sheet, documented and dead.
//
// Bindings covered elsewhere:
//
//   /  ArrowUp/Down  Enter  Escape   finder.spec.ts   (the finder's own scope)
//   n                                follow.spec.ts   (jump to playing)
//   l  d  a                          now-playing.spec.ts (the panels they open)
//   h                                heat.spec.ts     (and finder.spec, where
//                                                      it must NOT fire)
//   Mod+Shift+p                      search-playback.spec.ts
//   Alt+ArrowDown                    sidebar.spec.ts  (against a real reorder)
//   Mod+B with the screen open       now-playing.spec.ts (whether it moves the
//                                                        screen is a reading of
//                                                        two boxes, and the
//                                                        reader is there)
//
// Mod is spelled ControlOrMeta rather than Meta: @tanstack/react-hotkeys and
// Playwright both map Mod by platform, so the literal would pass here and fail
// on Linux.

// Matched on the label's own text rather than on the button's: `Library` is
// inside `#Jean Library`, which the user owns and the sidebar draws.
const sidebarLink = (page: Page, title: string) =>
	sidebar(page)
		.getByRole("button")
		.filter({ has: page.getByText(title, { exact: true }) });

const currentSidebarRow = (page: Page) =>
	sidebar(page).locator('button[aria-current="true"]');

const commandsTo = (player: FakePlayer, route: string) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path === route,
	);

const bodiesTo = (player: FakePlayer, route: string) =>
	commandsTo(player, route).map((entry) => entry.body ?? {});

test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

test.describe("playback", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("Space plays and pauses", async ({ page, player }) => {
		// Focus is on the body: Space on a focused button activates the button
		// instead.
		await page.keyboard.press("Space");
		await expect
			.poll(() => commandsTo(player, "/api/playback/play-pause"))
			.toHaveLength(1);
	});

	test("Mod with the horizontal arrows changes track", async ({
		page,
		player,
	}) => {
		await page.keyboard.press("ControlOrMeta+ArrowRight");
		await expect
			.poll(() => commandsTo(player, "/api/playback/next"))
			.toHaveLength(1);

		await page.keyboard.press("ControlOrMeta+ArrowLeft");
		await expect
			.poll(() => commandsTo(player, "/api/playback/previous"))
			.toHaveLength(1);
	});

	test("Mod+ArrowLeft restarts a track that has been playing a while", async ({
		page,
		player,
	}) => {
		await trackRow(page, 1).dblclick();
		player.patchPlayer({ position: 60 });
		await expect
			.poll(() =>
				page
					.getByRole("slider", { name: "Playback position" })
					.getAttribute("aria-valuenow")
					.then(Number),
			)
			.toBeGreaterThanOrEqual(60);

		await page.keyboard.press("ControlOrMeta+ArrowLeft");

		await expect
			.poll(() =>
				bodiesTo(player, "/api/playback/seek").filter(
					(body) => body.seconds === 0,
				),
			)
			.toHaveLength(1);
		expect(commandsTo(player, "/api/playback/previous")).toHaveLength(0);
	});

	test("Mod+. stops", async ({ page, player }) => {
		await page.keyboard.press("ControlOrMeta+.");
		await expect
			.poll(() => commandsTo(player, "/api/playback/stop"))
			.toHaveLength(1);
	});

	test("the bare horizontal arrows seek instead", async ({ page, player }) => {
		// Only the vertical pair moves the list cursor, which is what leaves these
		// two free.
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");

		await expect
			.poll(() => bodiesTo(player, "/api/playback/seek"))
			.toHaveLength(2);

		expect(bodiesTo(player, "/api/playback/seek")).toEqual([
			{ relativeSeconds: 5 },
			{ relativeSeconds: -5 },
		]);
		expect(commandsTo(player, "/api/playback/next")).toHaveLength(0);
		expect(commandsTo(player, "/api/playback/previous")).toHaveLength(0);
	});

	test("= and - move the volume", async ({ page, player }) => {
		// Known and unfixed: on Spanish, French and German layouts '=' is Shift+0,
		// the matcher compares modifier state strictly, and the fallback to
		// event.code finds Digit0 rather than Equal, so volume up is unreachable
		// there. The test asserts the layout it can drive.
		await page.keyboard.press("=");
		await expect
			.poll(() => bodiesTo(player, "/api/volume"))
			.toEqual([{ step: "up" }]);

		await page.keyboard.press("-");
		await expect
			.poll(() => bodiesTo(player, "/api/volume"))
			.toEqual([{ step: "up" }, { step: "down" }]);
	});

	test("m mutes and unmutes", async ({ page, player }) => {
		await page.keyboard.press("m");
		await expect.poll(() => player.player.volume.isMuted).toBe(true);

		await page.keyboard.press("m");
		await expect.poll(() => player.player.volume.isMuted).toBe(false);
		expect(bodiesTo(player, "/api/volume")).toEqual([
			{ muted: true },
			{ muted: false },
		]);
	});
});

test.describe("a transport command, as the component sees it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	const COMMAND = /^\/api\/(playback\/[a-z-]+|volume)$/;

	test("every command key reaches the route the component answers", async ({
		page,
	}) => {
		const sent: string[] = [];
		page.on("request", (request) => {
			const { pathname } = new URL(request.url());
			if (request.method() === "POST" && COMMAND.test(pathname))
				sent.push(pathname);
		});

		await inSequence(
			[
				"Space",
				"ControlOrMeta+ArrowRight",
				"ControlOrMeta+ArrowLeft",
				"ControlOrMeta+.",
				"ArrowRight",
				"=",
				"m",
			],
			(key) => page.keyboard.press(key),
		);
		// Last, since Space on a focused button presses the button instead.
		await statusBar(page).getByRole("button", { name: "Shuffle" }).click();

		await expect
			.poll(() => [...new Set(sent)].sort())
			.toEqual([
				"/api/playback/mode",
				"/api/playback/next",
				"/api/playback/play-pause",
				"/api/playback/previous",
				"/api/playback/seek",
				"/api/playback/stop",
				"/api/volume",
			]);
	});

	test.describe("across a whole session", () => {
		// Row 0 on foobar2000's own scale, so the digit has a track it may write.
		test.use({ retagged: { "Los Calientes": { "%rating%": "0" } } });

		// Every step waits on the player having acted, so an empty log is a session that reached the
		// component and never paid a preflight, rather than one that sent nothing at all.
		test("no request is ever preflighted", async ({ page, player }) => {
			await trackRow(page, 0).dblclick();
			await expect.poll(() => player.player.playbackState).toBe("playing");

			await page.keyboard.press("4");
			await expect.poll(() => commandsTo(player, "/api/tags")).toHaveLength(1);

			await trackRow(page, 0).click({ button: "right" });
			await page.getByRole("menuitem", { name: "Add to queue" }).click();
			await expect.poll(() => player.playQueue.length).toBe(1);

			await listenHere(page);

			await expectSettlesAt(
				player,
				() =>
					player.requests
						.filter((entry) => entry.method === "OPTIONS")
						.map((entry) => entry.path),
				[],
			);
		});
	});
});

test.describe("navigation and appearance", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("Mod+K puts the cursor in the library search", async ({ page }) => {
		await expect(searchField(page)).not.toBeFocused();
		await page.keyboard.press("ControlOrMeta+k");

		// Mod+K searches the whole library; '/' filters the list on screen.
		await expect(searchField(page)).toBeFocused();
	});

	test("Mod+Home goes back to the top of the view", async ({ page }) => {
		await expect(trackRow(page, 0)).toBeAttached();
		await scrollTo(page, 2000);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

		// Above the list rather than to its first row: bare Home is the cursor's, and the header is
		// what a long playlist has scrolled off.
		await page.keyboard.press("ControlOrMeta+Home");
		await expect.poll(() => scrollTop(page)).toBe(0);
	});

	test("Mod+B hides the sidebar and brings it back", async ({ page }) => {
		await expect(sidebarLink(page, "Favorites")).toBeVisible();

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeHidden();

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeVisible();
	});

	test("and brings it back with the caret on it", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeHidden();

		await page.keyboard.press("ControlOrMeta+b");
		// The row for wherever you already are, rather than the top of the list.
		await expect(sidebarLink(page, "Library")).toBeFocused();
	});

	test("B goes to the sidebar without hiding it first", async ({ page }) => {
		await expect(sidebarLink(page, "Library")).not.toBeFocused();

		await page.keyboard.press("b");
		await expect(sidebarLink(page, "Library")).toBeFocused();
	});

	test("B reveals a hidden sidebar rather than doing nothing", async ({
		page,
	}) => {
		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeHidden();

		await page.keyboard.press("b");
		await expect(sidebarLink(page, "Library")).toBeFocused();
	});

	// Opened over All music rather than over the playlist the rest of this file
	// works in, so that the row reading as current is not also the first row: the
	// caret falls back to the first row when no row reads as current, and a case
	// where the two coincide goes green either way.
	test("b lands the caret on the row that reads as current, with the screen open", async ({
		page,
	}) => {
		await openAllMusic(page);
		await openNowPlaying(page);
		await expect(currentSidebarRow(page)).toHaveText(["All music"]);

		await page.keyboard.press("b");
		await expect(sidebarLink(page, "All music")).toBeFocused();
		await expect(sidebarLink(page, "Home")).not.toBeFocused();
	});

	test("? opens the shortcut sheet", async ({ page }) => {
		// Playwright sends `key: '?'` with shiftKey set, as a browser does on every
		// layout. The binding matches that rather than the physical slash key, which
		// is elsewhere on Dvorak, Spanish and French.
		await page.keyboard.press("Shift+?");
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
		await expect(sheet).toBeVisible();

		// The sheet is rendered from the array the bindings are registered from, so
		// it cannot drift from what fires while it lists every group.
		await inSequence(["Playback", "Navigation", "In a playlist"], (group) =>
			expect(sheet.getByRole("heading", { name: group })).toBeVisible(),
		);

		// The finder's keys are bound and deliberately undocumented.
		await expect(
			sheet.getByRole("heading", { name: "While finding" }),
		).toHaveCount(0);
	});

	test("the sheet draws one keycap per key, not one per chord", async ({
		page,
	}) => {
		await page.keyboard.press("Shift+?");
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });

		// `formatForDisplay` hands back "⌘ K" in one string; two keys are two caps.
		const nextTrack = sheet
			.locator("div")
			.filter({ hasText: /^Next track/ })
			.last();
		await expect(nextTrack.locator("kbd")).toHaveCount(2);

		// `?` is one cap despite being registered under two spellings, for layouts
		// that do and do not shift to reach it.
		const shortcuts = sheet
			.locator("div")
			.filter({ hasText: /^Keyboard shortcuts/ })
			.last();
		await expect(shortcuts.locator("kbd")).toHaveText(["?"]);
	});

	test("the sheet lists F under While what's playing is open", async ({
		page,
	}) => {
		await page.keyboard.press("Shift+?");
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });

		// The group is how the key carries its condition, the way L, D and A do, so
		// the row has to be in this section rather than merely in the sheet.
		const whatIsPlaying = sheet.locator("section").filter({
			has: page.getByRole("heading", {
				name: "While what's playing is open",
			}),
		});
		const row = whatIsPlaying
			.locator("div")
			.filter({ has: page.locator("kbd", { hasText: /^F$/ }) });

		await expect(row.locator("kbd")).toHaveText(["F"]);

		// A key with nothing beside it is what a missing phrase looks like. Which
		// words go there is not this test's business.
		await expect(row.locator("span").first()).not.toBeEmpty();
	});

	test("w shows what is playing and hides it again", async ({
		page,
		player,
	}) => {
		await page.keyboard.press("w");
		await expect(nowPlayingScreen(page)).toBeVisible();

		const guid = player.playlists.find(
			(entry) => entry.title === "Library",
		)!.guid;

		// The hash rather than the element: dismissing navigates at once and takes
		// the exit animation to leave.
		await page.keyboard.press("w");
		await expect(page).toHaveURL(new RegExp(`#/${guid}$`));
	});

	test("p goes to what is playing", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		// Jean's own account of what is playing, which is the whole of what `p` acts
		// on. The player holding the track is a different fact and arrives first: this
		// client still has to learn which set it came from before the key means
		// anything.
		await expectPlayingFrom(page, "All music");

		const guid = player.playlists.find(
			(entry) => entry.title === "Favorites",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await page.keyboard.press("p");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test("Escape closes the sheet, and so does ? again", async ({ page }) => {
		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });

		await page.keyboard.press("Shift+?");
		await expect(sheet).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		// The binding that opened it is the one registration that survives its own
		// hold on the keyboard, or it could not close what it opened.
		await page.keyboard.press("Shift+?");
		await expect(sheet).toBeVisible();
		await page.keyboard.press("Shift+?");
		await expect(sheet).toBeHidden();
	});

	test("the app behind the sheet is quiet", async ({ page, player }) => {
		await page.keyboard.press("Shift+?");
		await expect(
			page.getByRole("dialog", { name: "Keyboard shortcuts" }),
		).toBeVisible();

		// A list nobody can see must not switch layout, and the music must not
		// start, because a key was pressed at the sheet.
		await page.keyboard.press("Space");
		await page.keyboard.press("v");
		await expect
			.poll(() => commandsTo(player, "/api/playback/play-pause"))
			.toHaveLength(0);
	});

	test("t switches the theme", async ({ page }) => {
		// The colours a user sees, and the control that offers the other one: an
		// attribute on <html> is neither, and the two custom-property sets are the
		// whole design rather than a flag.
		const surface = () =>
			page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		const offered = () =>
			page
				.getByRole("button", { name: /Switch to (light|dark) theme/ })
				.getAttribute("aria-label");

		const before = await surface();
		const wasOffered = await offered();

		await page.keyboard.press("t");
		await expect.poll(surface).not.toBe(before);
		await expect.poll(offered).not.toBe(wasOffered);

		await page.keyboard.press("t");
		await expect.poll(surface).toBe(before);
		await expect.poll(offered).toBe(wasOffered);
	});
});

test.describe("moving the cursor in a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	// The cursor is an index in state, not DOM focus: the virtualiser unmounts a
	// focused row the moment it scrolls away, and focus would evaporate with it.
	const cursorRow = (page: Page) =>
		page.locator('[role="row"][data-cursor="true"]');
	const cursorAt = async (page: Page, index: number) =>
		expect(cursorRow(page)).toHaveAttribute("data-row", String(index));

	test("the arrows move it, and nothing else has to", async ({ page }) => {
		await cursorAt(page, 0);

		await page.keyboard.press("ArrowDown");
		await cursorAt(page, 1);
		await page.keyboard.press("ArrowDown");
		await cursorAt(page, 2);

		await page.keyboard.press("ArrowUp");
		await cursorAt(page, 1);

		// j is not bound; the arrows are the only spelling.
		await page.keyboard.press("j");
		await cursorAt(page, 1);
	});

	test("Home and End reach both ends", async ({ page }) => {
		await page.keyboard.press("End");
		await cursorAt(page, 53);

		await page.keyboard.press("Home");
		await cursorAt(page, 0);
	});

	test("the page keys move further than one row and stop at the ends", async ({
		page,
	}) => {
		await page.keyboard.press("PageDown");
		const afterPageDown = Number(
			await cursorRow(page).getAttribute("data-row"),
		);
		expect(afterPageDown).toBeGreaterThan(1);

		await page.keyboard.press("PageUp");
		await cursorAt(page, 0);

		await page.keyboard.press("PageUp");
		await cursorAt(page, 0);
	});
});

test.describe("selecting in a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	const selected = (page: Page) =>
		page.locator('[role="row"][data-selected="true"]');

	test("Shift with the arrows extends the selection", async ({ page }) => {
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(selected(page)).toHaveCount(3);

		await page.keyboard.press("Shift+ArrowUp");
		await expect(selected(page)).toHaveCount(2);
	});

	test("clicking away from the rows drops the selection", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");
		await expect(selected(page).first()).toBeVisible();

		// The title stands in for background: with 54 rows the list is taller than
		// the window and there is no empty space under it.
		await page.getByRole("heading", { level: 1 }).click();
		await expect(selected(page)).toHaveCount(0);
	});

	test("a control in the view does not drop it", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");
		const before = await selected(page).count();
		expect(before).toBeGreaterThan(1);

		await page.getByRole("button", { name: "Play-count heat" }).click();
		await expect(selected(page)).toHaveCount(before);
	});

	test("Mod+A takes everything and Escape gives it back", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+a");

		// The whole playlist rather than the screenful that happened to be mounted:
		// counting rows on screen and comparing the selection to that number passes
		// for an implementation that only ever selects what it can see. The menu
		// reports the size of the selection itself.
		await trackRow(page, 0).click({ button: "right" });
		// Scoped to the menu, which is a portal outside the app root: the view
		// header behind it counts the playlist and says "54 tracks" as well.
		const menu = page
			.locator("body > div")
			.filter({ has: page.getByRole("menuitem", { name: "Add to playlist" }) });
		await expect(menu).toContainText("54 tracks");
		await page.keyboard.press("Escape");

		// And the last row is in it, which is nowhere near the fold on either
		// viewport.
		await scrollUntilMounted(page, trackRow(page, 53));
		await expect(trackRow(page, 53)).toHaveAttribute("aria-selected", "true");

		await page.keyboard.press("Escape");
		await expect(selected(page)).toHaveCount(0);
	});
});

test.describe("view keys", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("v switches between the compact and album layouts", async ({ page }) => {
		const layout = (name: string) =>
			page.getByRole("button", { name, exact: true });
		await expect(layout("List")).toHaveAttribute("aria-pressed", "true");

		await page.keyboard.press("v");
		await expect(layout("Albums")).toHaveAttribute("aria-pressed", "true");

		// Rows are grouped in the album layout, so the measurements cached by index
		// mean something else entirely.
		await expect(
			page.locator("section").filter({ hasText: "Jessico" }),
		).toBeVisible();

		await page.keyboard.press("v");
		await expect(layout("List")).toHaveAttribute("aria-pressed", "true");
	});
});

test.describe("in search results", () => {
	test("Mod+S offers to save the results as a playlist", async ({ page }) => {
		await page.goto("/#/search");
		await searchFor(page, "babasonicos");
		await expect(trackRow(page, 0)).toBeAttached();

		// Committing takes the caret out of the field, so it is put back: the binding
		// has to fire with the caret in there, which is where a refining user leaves it.
		await searchField(page).click();
		await page.keyboard.press("ControlOrMeta+s");
		await expect(
			page.getByRole("textbox", { name: "Playlist name" }),
		).toBeVisible();
	});
});

test.describe("in the sidebar", () => {
	test("the arrows walk the rows, and the track list does not follow", async ({
		page,
	}) => {
		await openLibrary(page);
		const cursor = page.locator('[role="row"][data-cursor="true"]');
		await expect(cursor).toHaveAttribute("data-row", "0");

		await page.keyboard.press("b");
		await expect(sidebarLink(page, "Library")).toBeFocused();

		await page.keyboard.press("ArrowDown");
		await expect(sidebarLink(page, "Favorites")).toBeFocused();

		await page.keyboard.press("ArrowUp");
		await expect(sidebarLink(page, "Library")).toBeFocused();

		// The manager fires every registration matching a key, so the list holding
		// the same two arrows is the whole reason the sidebar stops the event.
		await expect(cursor).toHaveAttribute("data-row", "0");
	});

	test("Enter on a row opens it", async ({ page }) => {
		await openLibrary(page);

		await page.keyboard.press("b");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");

		await expect(
			page.getByRole("heading", { level: 1, name: "Favorites" }),
		).toBeVisible();
	});

	test("Alt+ArrowUp moves a playlist up", async ({ page, player }) => {
		await openLibrary(page);

		// Registered only while a row holds focus, so arrow keys with a modifier
		// cannot fire while the cursor is in the track list.
		await sidebarLink(page, "Favorites").focus();
		await page.keyboard.press("Alt+ArrowUp");

		await expect
			.poll(() => player.playlists.map((entry) => entry.title).slice(0, 3))
			.toEqual(["Default Playlist", "Favorites", "Library"]);
	});
});

test.describe("with the full-screen lyric open", () => {
	// A lyric to expand, and a rating on the track carrying it: the digit keys are
	// part of what has to go quiet, and a track on a scale Jean will not write
	// would refuse the digit for a reason of its own.
	test.use({
		...TAGGED,
		retagged: {
			...TAGGED.retagged,
			"Los Calientes": {
				...TAGGED.retagged["Los Calientes"],
				"%rating%": "5",
			},
		},
	});

	const lyricScreenClose = (page: Page) =>
		page.getByRole("button", { name: "Close full-screen lyrics" });

	const openTheLyricScreen = async (page: Page) => {
		await panelTab(nowPlayingScreen(page), "Lyrics").click();
		await page.getByRole("button", { name: "Full-screen lyrics" }).click();
		await expect(lyricScreenClose(page)).toBeVisible();
	};

	const closeTheLyricScreen = async (page: Page) => {
		await lyricScreenClose(page).click();
		await expect(lyricScreenClose(page)).toHaveCount(0);
	};

	const queuePanel = (page: Page) =>
		page.getByRole("complementary", { name: "Queue" });

	const ratingOnTheScreen = (page: Page) =>
		nowPlayingScreen(page).getByRole("group", { name: /stars|Unrated/ });

	const tagWrites = (player: FakePlayer) =>
		requestsTo(player, "/api/tags").filter((entry) => entry.method === "POST");

	// One case per key rather than one case pressing all six. A keyboard that is
	// off is proved by absence, and absence is proved one key at a time: a case
	// that goes red says which key got through.
	//
	// Each key is pressed twice, once while the screen is up and once after it has
	// gone. The second press is what stops the first assertion passing for a key
	// that was never going to do anything, and the closing click between them is
	// what makes the reading settled: a key that reached the keymap has already
	// acted by the time that click has landed.
	//
	// Escape is not in the list. It is the way out, and it is not a keymap binding
	// at all: `useEscapeCapture` takes it in the capture phase.

	test("Space leaves the transport alone, and reaches it again after it closes", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await openTheLyricScreen(page);

		await page.keyboard.press("Space");

		await closeTheLyricScreen(page);
		await expectSettlesAt(
			player,
			() => commandsTo(player, "/api/playback/play-pause"),
			[],
		);
		// The player as well as the wire, because a miss here is the music stopping.
		expect(player.player.playbackState).toBe("playing");

		await page.keyboard.press("Space");
		await expect.poll(() => player.player.playbackState).toBe("paused");
	});

	test("Mod+B leaves the sidebar where it is, and moves it again after it closes", async ({
		page,
	}) => {
		await playRow(page, 0);
		await expect(sidebarLink(page, "Favorites")).toBeVisible();
		await openTheLyricScreen(page);

		await page.keyboard.press("ControlOrMeta+b");

		await closeTheLyricScreen(page);
		await expect(sidebarLink(page, "Favorites")).toBeVisible();

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebarLink(page, "Favorites")).toBeHidden();
	});

	// Started with the sidebar hidden, because revealing it is the half of `b` that
	// outlives the closing click. The click takes focus itself, so a caret this key
	// had put on a row is gone by the time the screen is.
	test("b leaves the sidebar hidden, and reveals it again after it closes", async ({
		page,
	}) => {
		await playRow(page, 0);
		await sidebarToggle(page).click();
		await expect(sidebarLink(page, "Favorites")).toBeHidden();
		await openTheLyricScreen(page);

		await page.keyboard.press("b");

		await closeTheLyricScreen(page);
		await expect(sidebarLink(page, "Favorites")).toBeHidden();

		await page.keyboard.press("b");
		await expect(sidebarLink(page, "Library")).toBeFocused();
	});

	test("W leaves the screen under it open, and dismisses it again after it closes", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await openTheLyricScreen(page);

		await page.keyboard.press("w");

		await closeTheLyricScreen(page);
		await expectTheScreenIsStillOpen(page);

		const guid = player.playlists.find(
			(entry) => entry.title === "Library",
		)!.guid;

		await page.keyboard.press("w");
		await expect(page).toHaveURL(new RegExp(`#/${guid}$`));
	});

	test("Q leaves the queue shut, and opens it again after it closes", async ({
		page,
	}) => {
		await playRow(page, 0);
		await openTheLyricScreen(page);

		await page.keyboard.press("q");

		await closeTheLyricScreen(page);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");

		await page.keyboard.press("q");
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
	});

	test("a rating digit writes nothing, and writes again after it closes", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		// The screen has to be holding the player's answer, or a digit would have
		// nothing to rate and the silence would mean something else.
		await expect(ratingOnTheScreen(page)).toHaveAccessibleName("5 of 5 stars");
		await openTheLyricScreen(page);

		await page.keyboard.press("4");

		await closeTheLyricScreen(page);
		await expectSettlesAt(player, () => tagWrites(player), []);

		await page.keyboard.press("4");
		await expectSettlesAt(player, () => tagWrites(player).length, 1);
	});
});
