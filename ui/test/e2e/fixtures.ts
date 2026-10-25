import type {
	APIRequestContext,
	Locator,
	Page,
	Request,
	Route,
} from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { JEAN_MODE_BY_ORDER } from "../fake-api/fooJean/playbackModes.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createServer, type FakeServer } from "../fake-api/server.ts";
import { postsToSession } from "../fake-api/sessions.ts";
import {
	createState,
	DEFAULT_PLAYLISTS,
	type FakePlayerState,
	type Track,
} from "../fake-api/state.ts";
import { evaluate } from "../fake-api/titleFormat.ts";
import { distDir } from "./dist.ts";

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
	unaskedRateLimits: undefined;
}

const DIST = distDir();

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

	// Defaults and what each option presents are in `FooJeanOptions`, `fake-api/fooJean/options.ts`.
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
					fooJean: {
						...fooJean,
						rateLimits: { ...COMPONENT_RATE_LIMITS, ...fooJean.rateLimits },
					},
				}),
			),
		);
	},

	// A `429` from one of the component's buckets means the client sent a burst the
	// player would refuse, whatever the test was looking at, so every test answers
	// for its own. One the test provokes on purpose is named in
	// `fooJean.expectRateLimited`.
	unaskedRateLimits: [
		async ({ player }, use) => {
			await use(undefined);
			const asked = new Set(player.fooJean.expectRateLimited);
			const refused = player.requests
				.filter((entry) => entry.limited && !asked.has(entry.limited))
				.map((entry) => `${askOf(entry)} (${entry.limited})`);
			expect(
				[...new Set(refused)],
				`foo_jean's rate limits refused ${refused.length} request(s) this test did not ask to be refused`,
			).toEqual([]);
		},
		{ auto: true },
	],

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

// The fake holds the order as a position in what the player declares. A name `foo_jean` has no
// mode for is declared and never offered, and a player sitting in it reports no mode at all.
export const playerDeclaring = (
	orders: readonly string[],
	current = orders[0],
): Partial<FakePlayerState> => {
	const position = orders.length === 0 ? 0 : orders.indexOf(current);
	if (position === -1) throw new Error(`${current} is not among ${orders}`);
	return {
		playbackMode: position,
		options: [
			{
				id: "playbackOrder",
				name: "Playback order",
				type: "enum",
				value: position,
				enumNames: [...orders],
			},
		],
	};
};

export const STOCK_ORDERS = Object.keys(JEAN_MODE_BY_ORDER);

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
// fetched is fresh for a week, so a case that means to watch which address a playing surface reaches
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

export const closeNowPlaying = async (page: Page) => {
	await nowPlayingScreen(page)
		.getByRole("button", { name: "Close now playing" })
		.click();
	await expect(nowPlayingScreen(page)).toBeHidden();
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

// On a compact viewport the transport is the now-playing screen, which this does not open.
export const orderButton = (
	page: Page,
	isCompact: boolean,
	title = "Playback order",
) =>
	(isCompact ? nowPlayingScreen(page) : statusBar(page)).getByRole("button", {
		name: new RegExp(`^${title}`),
	});

// The list a press of the order button opens is a menu on a desktop and a dialog holding one on a
// compact viewport.
export const expectNothingOpened = async (page: Page) => {
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toHaveCount(0);
};

export const orderList = (page: Page) => page.getByRole("menu");

export const orderRow = (page: Page, name: string) =>
	orderList(page).getByRole("menuitemradio", { name, exact: true });

export const checkedOrderRows = (page: Page) =>
	orderList(page).getByRole("menuitemradio", { checked: true });

// The transport is drawn once the player has answered, and a key pressed before the order button
// exists is not held for it.
export const openLibraryWithTheOrderButton = async (
	page: Page,
	title?: string,
) => {
	await openLibrary(page);
	await expect(orderButton(page, false, title)).toBeVisible();
};

// What an install offers arrives with its capabilities. Until it has, a control that depends on
// the offer is absent or disabled on every install, so an assertion that it is not there proves
// nothing.
export const untilTheInstallIsKnown = async (player: FakePlayer) => {
	await expect
		.poll(() => requestsTo(player, "/api/capabilities").length)
		.toBeGreaterThan(0);
	await untilQuiet(player);
};

// The layer toasts are drawn in. A finder's count and an autoplaylist's results are status regions
// too, so the role alone does not name it.
export const toastRegion = (page: Page) => page.locator("[data-toasts]");

export const playbackOffToast = (page: Page) =>
	toastRegion(page).filter({ hasText: /controlPlayback/ });

// Every toast on the page, found by the button each is dismissed with. The region they are drawn
// in also holds the notice that the player has stopped answering, which is not a toast and has no
// such button.
export const toasts = (page: Page) =>
	toastRegion(page).getByRole("button", { name: "Dismiss" });

// Every message the page puts up in a status region from here on, the toast layer among them. A
// toast takes itself down after a few seconds, so looking for one afterwards cannot tell "never
// said" from "said and gone", and a retrying `toHaveCount(0)` waits a real one out and passes. A
// case that promises silence reads it off this record, kept from before the press.
export const watchWhatIsSaid = async (page: Page) => {
	await page.evaluate(() => {
		const said: string[] = [];
		(window as unknown as { said: string[] }).said = said;
		new MutationObserver(() => {
			for (const layer of document.querySelectorAll('[role="status"]')) {
				const text = layer.textContent ?? "";
				if (text && !said.includes(text)) said.push(text);
			}
		}).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});

	return () =>
		page.evaluate(() => (window as unknown as { said: string[] }).said);
};

// lucide-react puts `lucide-{name}` on the `svg` it draws, among other classes.
export const drawing = (icon: string) =>
	new RegExp(`(^|\\s)lucide-${icon}(\\s|$)`);

// What a custom property resolves to inside `scope`, in the form Chromium computes a colour to.
export const tokenColourIn = (scope: Locator, token: string) =>
	scope.evaluate((element, name) => {
		const probe = document.createElement("span");
		probe.style.color = `var(${name})`;
		element.append(probe);
		const colour = getComputedStyle(probe).color;
		probe.remove();
		return colour;
	}, token);

// A Lucide icon is strokes and no fill, and Chromium computes a stroke of `currentColor` to the
// colour it resolves to.
export const drawnColour = (icon: Locator) =>
	icon.evaluate((svg) => getComputedStyle(svg).stroke);

// Polled, since a colour partway through a transition computes to `oklab()` in Chromium and to the
// token's own value only once it lands.
export const expectDrawnIn = (icon: Locator, colour: string) =>
	expect.poll(() => drawnColour(icon)).toBe(colour);

// The status bar's button for the "Playing on" panel, under whichever of its three names the page
// has given it.
export const pickerOpener = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /^(Choose where to play|Playing on this device|Playing what .+ started)/,
	});

export const playingOn = (page: Page) =>
	page.getByRole("group", { name: "Playing on" });

export const deviceAudio = async (page: Page) => {
	const audio = await page.evaluate(() => {
		const element = document.querySelector("audio");
		return element ? { volume: element.volume, isMuted: element.muted } : null;
	});
	if (!audio) throw new Error("no <audio> on the page");
	return audio;
};

// `listeningPosition` answers null until audio is rendering, so the element's
// own clock is the only proof the stream arrived.
export const listenHere = async (page: Page) => {
	await pickerOpener(page).click();
	await playingOn(page)
		.getByRole("button", { name: "Listen here", exact: true })
		.click();
	await page.waitForFunction(
		() => {
			const audio = document.querySelector("audio");
			return Boolean(audio && audio.currentTime > 0);
		},
		undefined,
		{ timeout: 60_000 },
	);
};

// A compact viewport draws the picker as a modal sheet over the whole app, so a press meant for the
// app behind it closes the sheet first. The desktop's popover leaves the app pressable.
export const putThePickerAway = async (page: Page, isCompact: boolean) => {
	if (!isCompact) return;
	await page
		.getByRole("dialog", { name: "Playing on" })
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
};

type MediaSessionHandlers = Partial<
	Record<MediaSessionAction, MediaSessionActionHandler | null>
>;

declare global {
	interface Window {
		__mediaSessionHandlers?: MediaSessionHandlers;
	}
}

// A browser's `navigator.mediaSession` has no getter for a handler, so the
// latest one per action is kept on the page as it is set. Installed before any
// page script runs, or the app has registered before the wrapper exists.
export const recordMediaSessionHandlers = (page: Page) =>
	page.addInitScript(() => {
		const handlers: MediaSessionHandlers = {};
		window.__mediaSessionHandlers = handlers;
		const session = navigator.mediaSession;
		const set = session.setActionHandler.bind(session);
		session.setActionHandler = (action, handler) => {
			set(action, handler);
			handlers[action] = handler;
		};
	});

export const MEDIA_SESSION_ACTIONS_WITH_CONTROL = [
	"nexttrack",
	"pause",
	"play",
	"previoustrack",
	"seekbackward",
	"seekforward",
	"seekto",
	"stop",
];

export const mediaSessionActions = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		const handlers = window.__mediaSessionHandlers;
		if (!handlers) throw new Error("recordMediaSessionHandlers was not called");
		return Object.entries(handlers)
			.filter(([, handler]) => handler)
			.map(([action]) => action)
			.sort();
	});

export const callMediaSessionAction = (
	page: Page,
	action: MediaSessionAction,
	details: Omit<MediaSessionActionDetails, "action"> = {},
) =>
	page.evaluate(
		({ action, details }) => {
			const handler = window.__mediaSessionHandlers?.[action];
			if (!handler) throw new Error(`no media session handler for ${action}`);
			handler({ ...details, action });
		},
		{ action, details },
	);

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

// foobar2000's own GUID for a playlist the fake keys as `key`, which is what
// every `foo_jean` route, and the route hash, names a playlist by.
export const guidOfPlaylist = (player: FakePlayer, key: string) => {
	const found = player.playlists.find((entry) => entry.id === key);
	if (!found) throw new Error(`no playlist ${key}`);
	return found.guid;
};

export const titleOfPlaylist = (player: FakePlayer, key: string) =>
	player.playlists.find((entry) => entry.id === key)!.title;

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

export const playFirstRow = async (page: Page, isMobile: boolean) => {
	await openLibrary(page);
	if (isMobile) await trackRow(page, 0).tap();
	else await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
	await expect(page).toHaveTitle(/^Los Calientes/);
};

// Started at the player rather than from the page, so nothing Jean sends is behind it.
export const playingAtThePlayer = async (page: Page, player: FakePlayer) => {
	player.playItem("p7", 2);
	await openLibrary(page);
	await expect(statusBar(page)).toContainText("Deléctrico");
};

export const openAllMusic = async (page: Page) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

export const searchField = (page: Page) =>
	page.getByRole("combobox", { name: "Search your library" });

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

export const routeOf = (path: string) => path.split("?")[0];

export const askOf = (entry: { method: string; path: string }) =>
	`${entry.method} ${routeOf(entry.path)}`;

export const countPostsTo = (player: FakePlayer, route: string) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && routeOf(entry.path) === route,
	).length;

export const ticksTaken = (player: FakePlayer) =>
	requestsTo(player, "/api/state").filter((one) => one.method === "GET").length;

export const tagWrites = (player: FakePlayer) =>
	requestsTo(player, "/api/tags").filter((one) => one.method === "POST");

// Every volume write from `from` on, whichever session it named.
export const volumesSent = (player: FakePlayer, from = 0) =>
	player.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method === "POST" && routeOf(entry.path) === "/api/volume",
		);

export const fieldOf = (track: Track, expression: string) =>
	String(evaluate(track, expression) ?? "");

export const titleOf = (track: Track) => fieldOf(track, "%title%");

export const countPostsToSession = (
	player: FakePlayer,
	route: string,
	session: string,
) => postsToSession(player.requests, route, session);

export const modesSent = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) => entry.method === "POST" && entry.path === "/api/playback/mode",
		)
		.map((entry) => entry.body?.mode);

// Every command a key or a gesture could send to the player. Starting a row goes by a playlist
// route and is not among them.
export const playbackCommands = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" && entry.path.startsWith("/api/playback/"),
		)
		.map((entry) => entry.path);

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

// ---- playback control off ---------------------------------------------------

// The fragment every refused control's name and every visible line must carry.
export const REASON = /playback control is off/i;

// The fourteen routes a player with `controlPlayback` off answers `403`.
export const REFUSED_ROUTES = [
	/^POST \/api\/playback\//,
	/^POST \/api\/volume$/,
	/^POST \/api\/playlists\/[^/]+\/items\/\d+\/play$/,
	/^(POST|DELETE) \/api\/queue(\/move|\/\d+)?$/,
	/^(POST|DELETE) \/api\/playlists\/own\/scratch\/items$/,
];

export const refusedAsks = (player: FakePlayer, since = 0) =>
	player.requests
		.slice(since)
		.map(askOf)
		.filter((route) => REFUSED_ROUTES.some((pattern) => pattern.test(route)));

export const expectNothingRefusedSent = (player: FakePlayer) =>
	expectSettlesAt(player, () => refusedAsks(player), []);

export const expectDisabledWithReason = async (control: Locator) => {
	await expect(control).toBeVisible();
	await expect(control).toHaveAttribute("aria-disabled", "true");
	await expect(control).toHaveAccessibleName(REASON);
	await control.focus();
	await expect(control).toBeFocused();
};

export const focusedEndOf = (dialog: Locator) =>
	dialog.evaluate((root) => {
		const stops = [
			...root.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		].filter((element) => element.getClientRects().length > 0);
		const focused = document.activeElement;
		if (focused === stops[0]) return "first";
		if (focused === stops[stops.length - 1]) return "last";
		return "neither";
	});

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

// Requests stopped in the browser until the test lets each one go, oldest first.
// Stopped on the way out by default, so what one carries back is whatever the
// player holds when it is let go. With `answered`, the player answers at once and
// the answer is what waits, so a request let go late still carries what the
// player held when it was asked: the only way to have an older answer land after
// a newer one. `count` is how many are caught; the rest go straight through, and
// so does everything once `releaseAll` has been called.
//
// Letting one go falls back to any route registered before this one, so two holds
// on the same requests compose: one registered first with `answered`, one after it
// without, holds a request on its way out and then holds its answer.
export const holdRequests = async (
	page: Page,
	matches: (request: Request) => boolean,
	{ answered = false, count = Number.POSITIVE_INFINITY } = {},
) => {
	const caught: Request[] = [];
	const waiting: ((settle: (route: Route) => Promise<void>) => void)[] = [];
	let holding = true;
	const letGo = (route: Route) => route.fallback();

	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const request = route.request();
			if (!holding || caught.length >= count || !matches(request))
				return route.fallback();
			caught.push(request);

			const response = answered ? await route.fetch() : null;
			const body = response ? await response.body() : null;
			const settle = await new Promise<(route: Route) => Promise<void>>(
				(resolve) => waiting.push(resolve),
			);
			// A request the page has since given up on can no longer be answered.
			await (response && settle === letGo
				? route.fulfill({ response, body: body ?? undefined })
				: settle(route)
			).catch(() => {});
		},
	);

	return {
		caught,
		untilHeld: (atLeast = 1) =>
			expect
				.poll(() => waiting.length, {
					message: `fewer than ${atLeast} matching requests were held`,
				})
				.toBeGreaterThanOrEqual(atLeast),
		release: () => waiting.shift()?.(letGo),
		// Answers the oldest held request with `settle` instead: `route.abort()` for
		// a connection that dropped, `route.fulfill({ status })` for a refusal.
		refuse: (settle: (route: Route) => Promise<void>) =>
			waiting.shift()?.(settle),
		releaseAll: () => {
			holding = false;
			while (waiting.length > 0) waiting.shift()?.(letGo);
		},
	};
};

export const HEADER_TILES_AT_MOST = 9;

// The rows a view header asked for its covers: each `POST /api/library/rows` naming
// `HEADER_TILES_AT_MOST` ordinals or fewer and answered 200, read in the browser
// because a first ask may be answered 202 while the declaration builds and asked again.
export const recordTileRowsAsked = (page: Page) => {
	const asked: number[][] = [];
	page.on("response", (response) => {
		const request = response.request();
		if (request.method() !== "POST" || response.status() !== 200) return;
		if (new URL(response.url()).pathname !== "/api/library/rows") return;
		const ordinals = request.postDataJSON()?.ordinals;
		if (Array.isArray(ordinals) && ordinals.length <= HEADER_TILES_AT_MOST)
			asked.push(ordinals);
	});
	return asked;
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
// `playlist GUID/row`.
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

export const titlesIn = (player: FakePlayer, playlistId: string) =>
	player.playlists
		.find((entry) => entry.id === playlistId)!
		.items.map((track) => track["%title%"]);

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

// See "A fake clock advances honestly only in small steps" in test/README.md.
export const CLOCK_STEP_MS = 250;

export const runClockFor = (page: Page, ms: number) =>
	times(Math.ceil(ms / CLOCK_STEP_MS), () => page.clock.runFor(CLOCK_STEP_MS));

// The tab's icon is a handle too, minted for every frame of a playing record and revoked at the
// next. It is a PNG off a canvas and every cover the fake serves is a JPEG, which is how the two
// are told apart.
const TAB_ICON_TYPE = "image/png";

// Installed before the page loads, since the first cover is fetched on the first render. The count
// is read back as `window.__mintedArtwork`.
export const countCoverHandles = (page: Page) =>
	page.addInitScript((iconType: string) => {
		const mint = URL.createObjectURL.bind(URL);
		let minted = 0;
		URL.createObjectURL = (object: Blob | MediaSource) => {
			if (!(object instanceof Blob && object.type === iconType)) minted += 1;
			return mint(object);
		};
		Object.defineProperty(window, "__mintedArtwork", { get: () => minted });
	}, TAB_ICON_TYPE);

// A player already holding Jean's declaration, as one does once any client has opened a list. A
// question or a read naming roles answers `202` or a null `cover` until something declares, and a
// page that opens on no list declares nothing.
export const holdingJeansDeclaration = (player: FakePlayer) => {
	player.startLibraryBuild([...TRACK_EXPRESSIONS]);
	player.finishLibraryBuild();
};
