import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import type { LibraryInfo, PlayerState } from "../../src/shared/api/types.ts";
import { inSequence } from "../../src/shared/lib/sequence.ts";
import type { FooJeanOptions } from "../fake-api/fooJean.ts";
import { createServer, type FakeServer } from "../fake-api/server.ts";
import {
	createState,
	DEFAULT_PLAYLISTS,
	libraryOfShape,
	type Track,
} from "../fake-api/state.ts";

export type FakePlayer = FakeServer["state"];

type LibraryShape = Parameters<typeof libraryOfShape>[0];

// Worker-scoped: one fake player per worker, so specs never share playlists.
interface JeanWorkerFixtures {
	fakeServer: FakeServer;
}

interface JeanFixtures {
	librarySize: number | null;
	mediaLibrarySize: number | null;
	libraryShape: LibraryShape | null;
	withoutPlaylists: boolean;
	withoutFields: string[];
	withoutLibraryPlaylist: boolean;
	library: Partial<LibraryInfo>;
	hasLibraryApi: boolean;
	retagged: Record<string, Track>;
	fooJean: FooJeanOptions | null;
	fooJeanToken: string | null;
	playerState: Partial<PlayerState> | null;
	player: FakePlayer;
	settings: Record<string, unknown>;
	firstRun: boolean;
	motion: "reduce" | "allow";
}

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");

// The play-count shading introduces itself on first sight and would otherwise
// cover the toolbar in every test that never asked about it. `firstRun` opts
// out of the seed entirely.
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
			// Listens for every test whether or not one asks for it; what makes the
			// component absent is the discovery record beefweb serves.
			await new Promise<void>((resolve) =>
				server.agent.listen(0, () => resolve()),
			);
			await use(server);
			await new Promise<void>((resolve) => server.agent.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
		{ scope: "worker" },
	],

	// How many tracks the Library playlist holds. Past a few thousand the app
	// behaves differently: rows arrive in chunks rather than one response.
	librarySize: [null, { option: true }],

	// How big the media library is, which is what `#/all` and search read on a
	// 0.11 player. The synthesised tracks deliberately do not sit in tag order,
	// so path order and browse order disagree.
	mediaLibrarySize: [null, { option: true }],

	// The shape of the media library rather than its size:
	// test.use({ libraryShape: { tracks: 4, albums: 1, omit: ['%year%'] } }).
	// Replaces the `#Jean Library` autoplaylist too, so both sources still
	// describe the same library.
	//
	// A description rather than the built tracks, because an option's top level
	// does not survive the trip to the worker as an array -- it arrives as
	// `{0: ..., 1: ...}`. Nested arrays are fine, which is why `omit` works.
	libraryShape: [null, { option: true }],

	// Everything except Jean's own, dropped: a fresh install.
	withoutPlaylists: [false, { option: true }],

	// Title-formatting expressions this player cannot resolve.
	// test.use({ withoutFields: ['%lastfm_play_count%'] }) is foobar2000 with no
	// playback-statistics component.
	withoutFields: [[], { option: true }],

	// Removes the playlist Jean resolves as the library, which is the only way to
	// reach the first-run path.
	withoutLibraryPlaylist: [false, { option: true }],

	// The media library's state, as beefweb 0.11+ reports it.
	// { supported: false } is DeaDBeeF, where every library endpoint answers 501;
	// { enabled: false } is foobar2000 with no media library configured. Both
	// send Jean back to the autoplaylist, for different reasons.
	//
	// JEAN_NO_LIBRARY_API=1 runs the whole suite against the autoplaylist
	// fallback instead. The same assertions should hold either way.
	library: [
		process.env.JEAN_NO_LIBRARY_API ? { supported: false } : {},
		{ option: true },
	],

	// Asked of the fixture rather than of the environment, so a spec that pins
	// `library` gets the right answer.
	hasLibraryApi: async ({ library }, use) => {
		await use(library.supported !== false && library.enabled !== false);
	},

	// Tag values the capture does not carry, keyed by track title:
	// test.use({ retagged: { Bloodhail: { '%artist%': 'Have a Nice Life feat. X' } } }).
	retagged: [{}, { option: true }],

	// The optional tag-writing component and the states it can present; absent by
	// default. See `fake-api/fooJean.ts` and `test/README.md`.
	fooJean: [null, { option: true }],

	// Seeded into localStorage separately from `settings`, because the token may
	// never travel through beefweb's clientconfig.
	fooJeanToken: [null, { option: true }],

	// Overrides merged onto the captured player state: permissions, the volume
	// range, which playback orders the player offers.
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
			withoutLibraryPlaylist,
			library,
			playerState,
			fooJean,
		},
		use,
	) => {
		// The ordinary playlist called 'Library' stays, and must not be mistaken
		// for the `#Jean Library` autoplaylist.
		const playlists = DEFAULT_PLAYLISTS().filter(
			(playlist) =>
				!(withoutLibraryPlaylist && playlist.title === "#Jean Library") &&
				!(withoutPlaylists && !playlist.title.startsWith("#Jean")),
		);

		await use(
			fakeServer.reset(
				createState({
					playlists,
					librarySize,
					mediaLibrarySize,
					mediaLibrary: libraryShape ? libraryOfShape(libraryShape) : null,
					withoutFields,
					retagged,
					library,
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

	// Merged over SEEDED_SETTINGS, so a spec names only what it changes.
	settings: [{}, { option: true }],

	// Nothing seeded at all, for the tests about a first run.
	firstRun: [false, { option: true }],

	// The play/pause toggle layers scale and rotate on coprime durations for as
	// long as something is playing, so its bounding box changes every frame.
	// Playwright waits for a box that holds still across two frames before it
	// will click, and against a permanently moving target that wait can only time
	// out. A spec that asserts on the motion itself opts out with
	// test.use({ motion: 'allow' }).
	motion: ["reduce", { option: true }],

	page: async (
		{ page, settings, firstRun, player, motion, fooJeanToken },
		use,
	) => {
		void player;
		if (motion === "reduce")
			await page.emulateMedia({ reducedMotion: "reduce" });
		await page.addInitScript(
			(values: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(values))
					window.localStorage.setItem(key, JSON.stringify(value));
			},
			{
				...(firstRun ? settings : { ...SEEDED_SETTINGS, ...settings }),
				...(fooJeanToken === null
					? null
					: { "jean.fooJeanToken": fooJeanToken }),
			},
		);
		await use(page);
	},
});

export type { Locator, Page } from "@playwright/test";
export { expect };

// ---- finding things on screen ----------------------------------------------

// data-row is the row's index in the view rather than in the playlist; the two
// differ the moment anything is filtered.
export const trackRow = (page: Page, index: number) =>
	page.locator(`[role="row"][data-row="${index}"]`);

export const rowByTitle = (page: Page, title: string) =>
	page.locator('[role="row"]').filter({ hasText: title }).first();

export const statusBar = (page: Page) => page.locator("footer");

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
	// toggle, so clicking that waits for a button the drawer is sitting on.
	await page.getByRole("button", { name: "Close menu" }).click();
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

export const settingsDialog = (page: Page) =>
	page.getByRole("dialog", { name: "Settings" });

export const openSettings = async (page: Page) => {
	// The gear lives in the top bar, so the app has to be loaded first.
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

// On a phone the sidebar is a drawer; on a desktop it is simply there. The
// toggle's label cannot tell the two apart -- it reads 'Show playlists' on a
// desktop as well -- so asking for it by name collapses a sidebar that was
// already open. Ask the sidebar itself instead.
export const openSidebar = async (page: Page) => {
	const home = sidebar(page).getByRole("button", { name: "Home" });
	if (await home.isVisible()) return;
	await page.getByRole("button", { name: "Show playlists" }).click();
	await expect(home).toBeVisible();
};

// The captured `Library` playlist, which most specs use as a list long enough to
// scroll. Not `#Jean Library`, which is Jean's own.
export const openLibrary = async (page: Page) => {
	await page.goto("/#/p7");
	await expect(
		page.getByRole("heading", { level: 1, name: "Library" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

// ---- reading the player -----------------------------------------------------

// What the app sent, from the fake's own log rather than the browser's.
export const requestsTo = (player: FakePlayer, pattern: string) =>
	player.requests.filter((entry) => entry.path.includes(pattern));

// The playlist Jean materialises to play a set from. Found by the prefix rather
// than by a title, because the title is named for whichever set filled it.
export const scratchOf = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title.startsWith("#Jean ["));

// The last thing the player was told to play, from
// /api/player/play/{plref}/{index}.
export const playedFrom = (player: FakePlayer) => {
	const play = requestsTo(player, "/player/play/").at(-1);
	if (!play) return null;
	const [, , , , plref, index] = play.path.split("/");
	return { plref, index: Number(index) };
};

// The track that request names, resolved through the playlist it names it in. A
// position and a track can agree on a number and disagree on a song, so nothing
// short of resolving it says anything.
export const trackPlayed = (player: FakePlayer) => {
	const at = playedFrom(player);
	if (!at) return null;
	const playlist = player.playlists.find((entry) => entry.id === at.plref);
	return playlist?.items[at.index]?.["%title%"] ?? null;
};

// ---- gestures ---------------------------------------------------------------

// A finger dragged between two points, driven through CDP rather than
// dispatched as DOM events: what these tests are usually about is the browser's
// own decision about who the gesture belongs to, and a dispatched `touchmove`
// sails past that and passes either way.
//
// Few steps on purpose. `useSwipe` reads anything slower than 600ms as a scroll
// that ended somewhere else rather than as a flick, so a drag padded out with
// round trips stops being the gesture under test.
export const touchDrag = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 4,
) => {
	const cdp = await page.context().newCDPSession(page);
	const send = (
		type: "touchStart" | "touchMove" | "touchEnd",
		point: { x: number; y: number },
	) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [point],
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
	await cdp.detach();
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

// Whether a row is on screen, which is not the same as whether it rendered:
// overscan deliberately mounts rows past the fold.
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

// The virtualiser only mounts what is near the viewport, so a row further down a
// playlist does not exist to be located until the list has been scrolled to it.
// A screenful at a time rather than a jump: in album mode the total height is an
// estimate until the groups have been measured, so any single jump is aimed at
// the wrong place.
export const scrollUntilMounted = async (page: Page, locator: Locator) => {
	// Wait for the view before scrolling it. Without this the poll below scrolls
	// a container with nothing in it and spends its whole budget before the rows
	// arrive, which shows up only in a full parallel run.
	await expect(page.locator('[role="row"]').first()).toBeAttached();

	await expect
		.poll(async () => {
			if (await locator.count()) return true;
			await page.evaluate(() => {
				const scroller = document.querySelector("main") as HTMLElement;
				scroller.scrollBy(0, scroller.clientHeight * 0.8);
			});
			return false;
		})
		.toBe(true);
	await expect(locator).toBeAttached();
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

// Playwright assertions share one page, so a list of steps has to be awaited in
// order rather than mapped into Promise.all.
export { inSequence };

export const times = (count: number, run: (index: number) => unknown) =>
	inSequence(
		Array.from({ length: count }, (_, index) => index),
		run,
	);
