import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
	APIRequestContext,
	CDPSession,
	Locator,
	Page,
} from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { createServer, type FakeServer } from "../fake-api/agentServer.ts";
import type { FooJeanOptions } from "../fake-api/fooJean.ts";
import {
	createState,
	DEFAULT_PLAYLISTS,
	type FakePlayerState,
	libraryOfShape,
	type Track,
} from "../fake-api/state.ts";

export type FakePlayer = FakeServer["state"];

type LibraryShape = Parameters<typeof libraryOfShape>[0];

interface JeanWorkerFixtures {
	fakeServer: FakeServer;
}

interface JeanFixtures {
	librarySize: number | null;
	mediaLibrarySize: number | null;
	libraryShape: LibraryShape | null;
	withoutPlaylists: boolean;
	withoutFields: string[];
	retagged: Record<string, Track>;
	embeddedArt: Record<string, string>;
	playlistsFromRow: Record<string, number>;
	countsPlays: boolean;
	fooJean: FooJeanOptions;
	playerState: Partial<FakePlayerState> | null;
	player: FakePlayer;
	settings: Record<string, unknown>;
	firstRun: boolean;
	motion: "reduce" | "allow";
}

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");

// The component's own origin, for a spec that talks to it directly rather than through the app.
// One server answers both now, so this is `baseURL` -- fetched rather than read off the config,
// since a spec only ever holds an `APIRequestContext`.
export const componentOrigin = async (request: APIRequestContext) => {
	const response = await request.get("/");
	return new URL(response.url()).origin;
};

// The fixture that seeded a page's fake player, for a helper that only takes a
// `Page`. Set from the `page` fixture below, which already depends on `player`
// to order the reset before navigation.
const playerOf = new WeakMap<Page, FakePlayer>();

const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
	// The fake stream is not Ogg, so the short-buffer path cannot demux it and would fall
	// back on every test that listens. Off here, and tested on its own in `listen.spec.ts`.
	"jean.lowLatencyStream": false,
};

export const test = base.extend<JeanFixtures, JeanWorkerFixtures>({
	fakeServer: [
		// Playwright reads a fixture's dependencies off this pattern, so an empty
		// one is how it says it has none.
		// biome-ignore lint/correctness/noEmptyPattern: no dependencies, see above
		async ({}, use) => {
			const server = createServer({ serveDir: DIST });
			await new Promise<void>((resolve) => server.listen(0, () => resolve()));
			await use(server);
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
		{ scope: "worker" },
	],

	librarySize: [null, { option: true }],

	// What `#/all` and search read on a 0.11 player.
	mediaLibrarySize: [null, { option: true }],

	libraryShape: [null, { option: true }],

	withoutPlaylists: [false, { option: true }],

	withoutFields: [[], { option: true }],

	retagged: [{}, { option: true }],

	embeddedArt: [{}, { option: true }],

	playlistsFromRow: [{}, { option: true }],

	countsPlays: [false, { option: true }],

	// Defaults and the states each option can present are in `test/README.md`.
	fooJean: [{}, { option: true }],

	playerState: [null, { option: true }],

	// A fresh player per test. The previous test's page is closed by now, so no
	// stream is left subscribed to the state being discarded.
	player: async (
		{
			fakeServer,
			librarySize,
			mediaLibrarySize,
			libraryShape,
			withoutPlaylists,
			withoutFields,
			retagged,
			embeddedArt,
			playlistsFromRow,
			countsPlays,
			playerState,
			fooJean,
		},
		use,
	) => {
		// Nothing in the default set is one of the component's own: it makes its
		// scratch on the first fill and takes a role then, so a player nobody has
		// played a set on has no playlist Jean keeps for itself. A title is no
		// longer a way to ask, and `#Jean Library` is the user's.
		const playlists = withoutPlaylists ? [] : DEFAULT_PLAYLISTS();

		await use(
			fakeServer.reset(
				createState({
					playlists,
					librarySize,
					mediaLibrarySize,
					mediaLibrary: libraryShape ? libraryOfShape(libraryShape) : null,
					withoutFields,
					retagged,
					embeddedArt,
					playlistsFromRow,
					countsPlays,
					player: playerState,
					fooJean,
				}),
			),
		);
	},

	baseURL: async ({ fakeServer }, use) => {
		const address = fakeServer.address();
		await use(
			`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
		);
	},

	settings: [{}, { option: true }],

	firstRun: [false, { option: true }],

	// The play/pause toggle layers scale and rotate on coprime durations for as
	// long as something is playing, so its bounding box changes every frame.
	// Playwright waits for a box that holds still across two frames before it
	// will click, and against a permanently moving target that wait can only time
	// out. A spec that asserts on the motion itself opts out with
	// test.use({ motion: 'allow' }).
	motion: ["reduce", { option: true }],

	page: async ({ page, settings, firstRun, player, motion }, use) => {
		playerOf.set(page, player);
		if (motion === "reduce")
			await page.emulateMedia({ reducedMotion: "reduce" });
		await page.addInitScript(
			(values: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(values))
					window.localStorage.setItem(key, JSON.stringify(value));
			},
			firstRun ? settings : { ...SEEDED_SETTINGS, ...settings },
		);
		await use(page);
	},
});

export type { Locator, Page } from "@playwright/test";
export { expect };

export const OFFERS_NO_SHUFFLE: Partial<FakePlayerState> = {
	options: [
		{
			id: "playbackOrder",
			name: "Playback order",
			type: "enum",
			value: 0,
			enumNames: ["Default", "Repeat (playlist)"],
		},
	],
};

// ---- finding things on screen ----------------------------------------------

// data-row is the row's index in the view rather than in the playlist; the two
// differ the moment anything is filtered.
export const trackRow = (page: Page, index: number) =>
	page.locator(`[role="row"][data-row="${index}"]`);

export const rowByTitle = (page: Page, title: string) =>
	page.locator('[role="row"]').filter({ hasText: title }).first();

export const statusBar = (page: Page) => page.locator("footer");

// The search route before anything has been searched for, which is the one view that draws no rows
// at all. Any other view of tracks asks for the cover of every record in it, and a cover already
// fetched is held for months, so a case that means to watch which address a playing surface reaches
// for has to open on a page that draws none.
//
// Waited on the status bar rather than on the empty list: no rows is true of a page that has not
// rendered yet. The full bar is drawn only once the player has answered.
export const withNoListOnScreen = async (page: Page) => {
	await page.goto("/#/search");
	await expect(
		statusBar(page).getByRole("button", { name: "Show current track" }),
	).toBeVisible();
	await expect(page.locator('main [role="row"]')).toHaveCount(0);
};

// Not "Now playing": that name belongs to the playing row's equalizer, and
// `play.spec` counts how many elements answer to it.
export const nowPlayingScreen = (page: Page) =>
	page.getByRole("region", { name: "Current track" });

// `data-open` is the drawer, not the desktop sidebar: on a desktop the toggle
// sets `isSidebarCollapsed` and this stays false, so closing here is a no-op
// there.
//
// A bare `page.goto('/#/p5')` is a hashchange rather than a load, so React state
// survives it and the drawer does not close the way it does when a row inside it
// is clicked.
export const closeSidebar = async (page: Page) => {
	// Not `sidebar()`: a closed drawer is `display: none`, so the role query does
	// not resolve at all and asking it for an attribute waits out the timeout.
	const nav = page.locator('nav[aria-label="Playlists"]');
	if ((await nav.count()) === 0) return;
	if ((await nav.getAttribute("data-open")) !== "true") return;
	// The scrim, not the toggle in the top bar: an open drawer overlaps its own
	// toggle, so clicking that waits for a button the drawer is sitting on. Near
	// the scrim's own right edge, since the drawer covers its middle on a phone.
	const scrim = page.getByRole("button", { name: "Close menu" });
	const across = (await scrim.boundingBox())?.width ?? 0;
	await scrim.click({ position: { x: across - 8, y: 8 } });
	await expect(nav).toHaveAttribute("data-open", "false");
};

// Idempotent, and it has to be: on a phone the screen replaces the status bar,
// so a second call would look for the button that opened it in the one place it
// is guaranteed not to be. Closes the drawer first, which covers the status bar
// on a phone and swallows the click.
export const openNowPlaying = async (page: Page) => {
	if (await nowPlayingScreen(page).isVisible()) return;
	await closeSidebar(page);
	await statusBar(page)
		.getByRole("button", { name: "Show current track" })
		.click();
	await expect(nowPlayingScreen(page)).toBeVisible();
};

/**
 * Where the global playback controls are, which is a question about the
 * viewport rather than about the control. The compact status bar is Play and
 * volume and nothing else; on a desktop everything is in the status bar.
 *
 * Opens the now-playing screen as a side effect on mobile.
 */
export async function globalControls(page: Page, isCompact: boolean) {
	if (!isCompact) return statusBar(page);
	await openNowPlaying(page);
	return nowPlayingScreen(page);
}

// `listeningPosition` answers null until audio is rendering, so the element's
// own clock is the only proof the stream arrived.
export const listenHere = async (page: Page) => {
	await statusBar(page)
		.getByRole("button", {
			name: /Choose where to play|Playing on this device/,
		})
		.click();
	await page.getByRole("button", { name: "Listen here" }).click();
	await page.waitForFunction(
		() => {
			const audio = document.querySelector("audio");
			return Boolean(audio && audio.currentTime > 0);
		},
		undefined,
		{ timeout: 60_000 },
	);
};

export const settingsDialog = (page: Page) =>
	page.getByRole("dialog", { name: "Settings" });

export const openSettings = async (page: Page) => {
	if (!page.url().includes("#")) await page.goto("/");
	if (await settingsDialog(page).isVisible()) return;
	await closeSidebar(page);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(settingsDialog(page)).toBeVisible();
};

export const viewHeader = (page: Page) => page.locator("main header").first();

export const expectPlayingFrom = async (page: Page, name: string) => {
	await openNowPlaying(page);
	// The header rather than the line: "Playing from" and the set's name are two
	// elements, so a text query matches the label alone and never the name.
	const header = nowPlayingScreen(page).locator("header");
	await expect(header).toContainText("Playing from");
	await expect(header).toContainText(name);
	await nowPlayingScreen(page)
		.getByRole("button", { name: "Close now playing" })
		.click();
	await expect(nowPlayingScreen(page)).toBeHidden();
};

export const sidebar = (page: Page) =>
	page.getByRole("navigation", { name: "Playlists" });

// The guard reads the sidebar rather than the toggle, so a call against one
// that is already open does nothing. Drop it and the click asks for a button
// named "Show playlists" when the toggle by then says "Hide playlists", and
// waits out the timeout for a control that is not there.
export const openSidebar = async (page: Page) => {
	const home = sidebar(page).getByRole("button", { name: "Home" });
	if (await home.isVisible()) return;
	await page.getByRole("button", { name: "Show playlists" }).click();
	await expect(home).toBeVisible();
};

// Either name: which one belongs to which state is `sidebar.spec.ts`'s
// question, and this is the one control either way.
export const sidebarToggle = (page: Page) =>
	page.getByRole("button", { name: /^(Show|Hide) playlists$/ });

// The hash as well as the element: a dismissed now-playing screen navigates at
// once and then takes its exit animation to leave, so one on its way out still
// answers to visible. The tab is part of the screen's own route and a track
// carrying a lyric selects one without being asked, so the suffix is open, and
// the route leaving /playing is what this catches.
export const expectTheScreenIsStillOpen = async (page: Page) => {
	await expect(page).toHaveURL(/#\/playing(\/(lyrics|details|artist))?$/);
	await expect(nowPlayingScreen(page)).toBeVisible();
};

// foobar2000's own GUID for a playlist beefweb calls by its id, which is what
// every `foo_jean` route, and the route hash, names a playlist by.
export const guidOfPlaylist = (player: FakePlayer, beefwebId: string) => {
	const found = player.playlists.find((entry) => entry.id === beefwebId);
	if (!found) throw new Error(`no playlist ${beefwebId}`);
	return found.guid;
};

// The captured `Library` playlist, which most specs use as a list long enough to
// scroll. Not `#Jean Library`, which carries Jean's own prefix and stays hidden.
export const openLibrary = async (page: Page) => {
	const player = playerOf.get(page);
	if (!player) throw new Error("openLibrary needs the player fixture");
	await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Library" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

export const openAllMusic = async (page: Page) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

export const searchField = (page: Page) =>
	page.getByLabel("Search your library");

export const revealSearch = async (page: Page) => {
	await closeSidebar(page);
	const icon = page.getByRole("button", { name: "Search your library" });
	if (await icon.isVisible()) await icon.click();
	await expect(searchField(page)).toBeVisible();
};

// The results page, specifically. Escape first because a query naming exactly one artist starts with
// the cursor on them, and Enter there is a commitment to the artist rather than to the search.
export const searchFor = async (page: Page, text: string) => {
	await revealSearch(page);
	await searchField(page).fill(text);
	await searchField(page).press("Escape");
	await searchField(page).press("Enter");
	await expect(
		page.getByRole("heading", { level: 1, name: text }),
	).toBeVisible();
};

// The player owner turning `writePlaylists` off with Jean already open. The
// component answers its capabilities once, at discovery, so every playlist
// control stays drawn and the next edit comes back 403. That is the only way a
// refusal reaches a control somebody can still press: an install that had the
// setting off at load draws none of them.
export const refusePlaylistWrites = async (page: Page) => {
	const answered = await page.request.post("/__control/writePlaylists", {
		data: { canWrite: false },
	});
	expect(
		answered.ok(),
		"the fake needs a control that turns writePlaylists off mid-test",
	).toBe(true);
};

// ---- reading the player -----------------------------------------------------

export const requestsTo = (player: FakePlayer, pattern: string) =>
	player.requests.filter((entry) => entry.path.includes(pattern));

const QUIET_MS = 250;

export const untilQuiet = async (player: FakePlayer) => {
	let seen = -1;
	await expect
		.poll(
			() => {
				const now = player.requests.length;
				const quiet = now === seen;
				seen = now;
				return quiet;
			},
			{ intervals: [QUIET_MS] },
		)
		.toBe(true);
};

export const expectSettlesAt = async <T>(
	player: FakePlayer,
	read: () => T | Promise<T>,
	expected: T,
) => {
	await expect.poll(read).toEqual(expected);
	await untilQuiet(player);
	// Widened, or the matcher does not resolve against an unbound generic.
	const settled: unknown = await read();
	expect(settled).toEqual(expected);
};

// Ticks handed over one at a time. A change made at the player reaches Jean on
// the poll and nowhere else, so what "within one poll" can be measured against
// is a supply of ticks the test owns: every one is refused, the change is made,
// then exactly one goes through. What the client does with that tick is
// untimed, so a slow machine waits rather than failing, and a client wanting a
// second tick never gets one.
export const holdThePoll = async (page: Page) => {
	let allowed = 0;
	let refused = 0;

	await page.route(
		(url) => url.pathname === "/api/state",
		async (route) => {
			if (allowed > 0) {
				allowed -= 1;
				return route.continue();
			}
			refused += 1;
			return route.abort();
		},
	);

	const untilRefusedAgain = async () => {
		const seen = refused;
		await expect
			.poll(() => refused, { message: "the poll stopped asking" })
			.toBeGreaterThan(seen);
	};

	// Held before the caller changes anything, so nothing it does can ride a tick
	// that was already in flight.
	await untilRefusedAgain();

	return {
		untilRefusedAgain,
		letOneThrough: () => {
			allowed = 1;
		},
	};
};

// The component addresses a cover by the track's library path, so this is the
// track each of its cover requests named. An empty string is a request that
// named no track at all, which the component answers 400.
export const coversFromTheComponent = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.startsWith("/api/artwork?"),
		)
		.map(
			(entry) =>
				new URLSearchParams(entry.path.slice(entry.path.indexOf("?"))).get(
					"track",
				) ?? "",
		);

// The component's fallback address for a row it has no library path for, as
// `playlist GUID/row`. Four path segments are what tell it from beefweb's own
// positional address, which has three and cannot resolve a GUID at all.
const COMPONENT_POSITIONAL_COVER =
	/^\/api\/artwork\/playlists\/([^/?]+)\/(\d+)$/;

export const coversByPosition = (player: FakePlayer) =>
	player.requests
		.filter((entry) => entry.method === "GET")
		.map((entry) => COMPONENT_POSITIONAL_COVER.exec(entry.path))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => `${match[1]}/${match[2]}`);

// The playlist Jean materialises to play a set from. Found by the prefix rather
// than by a title, because the title is named for whichever set filled it.
export const scratchOf = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title.startsWith("#Jean ["));

export const scratchFills = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			entry.path === "/api/playlists/own/scratch/items",
	);

const PLAY_ROUTE = /^\/api\/playlists\/([^/]+)\/items\/(\d+)\/play$/;

// Every call to POST /api/playlists/{id}/items/{index}/play, in order.
export const playRequests = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && PLAY_ROUTE.test(entry.path),
	);

// The last thing the player was told to play, from
// POST /api/playlists/{id}/items/{index}/play.
export const playedFrom = (player: FakePlayer) => {
	const play = playRequests(player).at(-1);
	if (!play) return null;
	const [, id, index] = PLAY_ROUTE.exec(play.path) as RegExpExecArray;
	return { id, index: Number(index) };
};

// The track that request names, resolved through the playlist it names it in. A
// position and a track can agree on a number and disagree on a song, so nothing
// short of resolving it says anything.
export const trackPlayed = (player: FakePlayer) => {
	const at = playedFrom(player);
	if (!at) return null;
	const playlist = player.playlists.find((entry) => entry.guid === at.id);
	return playlist?.items[at.index]?.["%title%"] ?? null;
};

// ---- gestures ---------------------------------------------------------------

// A finger dragged between two points, driven through CDP rather than
// dispatched as DOM events: what these tests are usually about is the browser's
// own decision about who the gesture belongs to, and a dispatched `touchmove`
// sails past that and passes either way. Why every point is stamped and why the
// session is one per page rather than one per drag: test/README.md.
const sessions = new WeakMap<Page, Promise<CDPSession>>();

const sessionFor = (page: Page) => {
	const held = sessions.get(page);
	if (held) return held;
	const session = page.context().newCDPSession(page);
	sessions.set(page, session);
	return session;
};

export const touchDrag = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 4,
) => {
	const cdp = await sessionFor(page);
	const at = Date.now() / 1000;
	let tick = 0;
	const send = (
		type: "touchStart" | "touchMove" | "touchEnd",
		point: { x: number; y: number },
	) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [point],
			timestamp: at + 0.02 * tick++,
		});

	await send("touchStart", from);
	await times(steps, (step) => {
		const at = (step + 1) / steps;
		return send("touchMove", {
			x: from.x + (to.x - from.x) * at,
			y: from.y + (to.y - from.y) * at,
		});
	});
	await send("touchEnd", to);
};

// Driven with the real mouse rather than dispatched events: pointer capture and
// the element's own rect are what is under test.
export const dragTo = async (
	page: Page,
	slider: Locator,
	fraction: number,
	steps = 20,
) => {
	const box = await slider.boundingBox();
	const vertical = box!.height > box!.width;
	const start = vertical
		? { x: box!.x + box!.width / 2, y: box!.y + box!.height }
		: { x: box!.x, y: box!.y + box!.height / 2 };
	const end = vertical
		? { x: box!.x + box!.width / 2, y: box!.y + box!.height * (1 - fraction) }
		: { x: box!.x + box!.width * fraction, y: box!.y + box!.height / 2 };

	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps });
	await page.mouse.up();
};

// Drags one element over another and stops there, still holding: a drop target
// arms on an animation frame rather than on the move, so a caller waits for it to
// light up before releasing, and one caller releases somewhere else on purpose.
export const dragFrom = async (page: Page, source: Locator, onto: Locator) => {
	const from = await source.boundingBox();
	const to = await onto.boundingBox();

	await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
	await page.mouse.down();
	await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
		steps: 16,
	});
};

// Press-and-hold, which is touch's right-click. Dispatched rather than driven by
// page.touchscreen, which has no way to hold. The synthetic click at the end is
// part of the gesture: a hold that stopped swallowing it would also activate
// whatever it opened the menu over.
export const pressAndHold = async (page: Page, target: Locator) => {
	const box = (await target.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	const touch = {
		pointerType: "touch",
		isPrimary: true,
		button: 0,
		clientX: box.x + box.width / 2,
		clientY: box.y + box.height / 2,
	};

	await target.dispatchEvent("pointerdown", touch);
	await page.waitForTimeout(520); // past the 420ms hold
	await target.dispatchEvent("pointerup", touch);
	await target.dispatchEvent("click", { ...touch, detail: 1 });
};

// ---- scrolling --------------------------------------------------------------

// Row heights, the scroll offset and the container's own rect are all
// fractional, so a row scrolled exactly to the bottom edge lands a few tenths of
// a pixel past it.
const EDGE_TOLERANCE_PX = 1;

export const isRowOnScreen = (page: Page, index: number) =>
	page.evaluate(
		({ row, slack }) => {
			const element = document.querySelector(`[role="row"][data-row="${row}"]`);
			if (!element) return false;
			const scroller = document.querySelector("main") as HTMLElement;
			const seen = element.getBoundingClientRect();
			const view = scroller.getBoundingClientRect();
			return seen.top >= view.top - slack && seen.bottom <= view.bottom + slack;
		},
		{ row: index, slack: EDGE_TOLERANCE_PX },
	);

// A step short of a screenful, so two consecutive steps overlap and no row can
// fall between them.
const SCREENFUL = 0.8;

// Frames the list may keep moving for before it is read anyway. A list that
// never comes to rest should fail on the assertion it was scrolled for, not on
// the test's own timeout with nothing said about why.
const STILLNESS_CAP_FRAMES = 90;

// Consecutive unchanged frames required to call the list settled, rather than
// one: a single match can be two samples either side of a change that is still
// in flight.
const STILL_FRAMES = 3;

const listHoldsStill = (page: Page) =>
	page.evaluate(
		([cap, stillFrames]: [number, number]) =>
			new Promise<void>((resolve) => {
				const scroller = document.querySelector("main") as HTMLElement;
				let last = "";
				let still = 0;
				let frames = 0;
				const tick = () => {
					const now = `${scroller.scrollTop}/${scroller.scrollHeight}`;
					still = now === last ? still + 1 : 0;
					last = now;
					frames += 1;
					if (still >= stillFrames || frames >= cap) resolve();
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		[STILLNESS_CAP_FRAMES, STILL_FRAMES] as [number, number],
	);

const scrollOneScreen = (page: Page) =>
	page.evaluate((fraction: number) => {
		const scroller = document.querySelector("main") as HTMLElement;
		const from = scroller.scrollTop;
		scroller.scrollBy(0, scroller.clientHeight * fraction);
		return scroller.scrollTop > from;
	}, SCREENFUL);

// The virtualiser only mounts what is near the viewport, so a row further down a
// playlist does not exist to be located until the list has been scrolled to it.
// A screenful at a time rather than a jump: in album mode the total height is an
// estimate until the groups have been measured, so any single jump is aimed at
// the wrong place.
//
// Every read is taken from a list that has come to rest, and that is the part
// that matters. While the groups are still estimated the list believes it is
// short enough to mount all of them at once, so a row far down it is attached
// for a moment and gone again once the measuring pass lands. A read taken
// before the list has settled can see that row and lose it again before
// anything acts on it.
//
// The loop is bounded by the list rather than by a clock. A step that moves
// nothing means the scroller is out of room, and two of them in a row mean it is
// really out of room: at an estimated bottom the first step can be refused and
// the next one have somewhere to go, once the groups down there have been
// measured and the total has grown.
export const scrollUntilMounted = async (page: Page, locator: Locator) => {
	// Wait for the view before scrolling it. Without this the loop below scrolls
	// a container with nothing in it, which shows up only in a full parallel run.
	await expect(page.locator('[role="row"]').first()).toBeAttached();

	let refusals = 0;
	while (refusals < 2) {
		await listHoldsStill(page);
		if (await locator.count()) break;
		refusals = (await scrollOneScreen(page)) ? 0 : refusals + 1;
	}

	await expect(
		locator,
		"the row never mounted, and the list ran out of room to scroll",
	).toBeAttached();
};

export const scrollTop = (page: Page) =>
	page.evaluate(
		() => (document.querySelector("main") as HTMLElement).scrollTop,
	);

export const scrollTo = (page: Page, offset: number) =>
	page.evaluate(
		(to) => (document.querySelector("main") as HTMLElement).scrollTo(0, to),
		offset,
	);

// ---- running steps one after the next ---------------------------------------

export const inSequence = <T>(
	items: readonly T[],
	run: (item: T, index: number) => unknown,
): Promise<unknown> =>
	items.reduce<Promise<unknown>>(
		(done, item, index) => done.then(() => run(item, index)),
		Promise.resolve(),
	);

export const times = (count: number, run: (index: number) => unknown) =>
	inSequence(
		Array.from({ length: count }, (_, index) => index),
		run,
	);
