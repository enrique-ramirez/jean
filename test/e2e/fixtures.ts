import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";

import type { LibraryInfo, PlayerState } from "../../src/shared/api/types.ts";
import type { FooJeanOptions } from "../fake-api/fooJean.ts";
import { createServer, type FakeServer } from "../fake-api/server.ts";
import {
	createState,
	DEFAULT_PLAYLISTS,
	libraryOfShape,
	type Track,
} from "../fake-api/state.ts";

// The fake player a spec is handed, for the helpers specs write of their own.
export type FakePlayer = FakeServer["state"];

// The shape a spec states with `test.use({ libraryShape: ... })`. Mirrors
// `libraryOfShape`'s options; see the fixture below for why it is a description
// rather than the built tracks.
type LibraryShape = Parameters<typeof libraryOfShape>[0];

// Everything a spec can pin with `test.use()`, plus what the fixtures build
// from it.
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

// Settings live in localStorage until they move to /api/clientconfig, and one of
// them changes what is on screen everywhere: the play-count shading introduces
// itself on first sight and would otherwise cover the toolbar in every test that
// never asked about it. Seeded by default and merged with whatever a spec adds,
// so a spec states only the setting it cares about. `firstRun` opts out of the
// seed entirely, for the tests that are about meeting Jean for the first time.
const SEEDED_SETTINGS = { "jean.heatIntroSeen": true };

export const test = base.extend<JeanFixtures, JeanWorkerFixtures>({
	// One fake player per worker, on a port the OS picks. Workers never share a
	// player, so the suite stays parallel without tests seeing each other's
	// playlists.
	fakeServer: [
		// Playwright reads a fixture's dependencies off this pattern, so an empty
		// one is how it says it has none.
		// biome-ignore lint/correctness/noEmptyPattern: no dependencies, see above
		async ({}, use) => {
			const server = createServer({ serveDir: DIST });
			await new Promise<void>((resolve) => server.listen(0, () => resolve()));
			// Listens for every test whether or not one asks for it; what makes it
			// absent is the discovery record beefweb serves.
			await new Promise<void>((resolve) =>
				server.agent.listen(0, () => resolve()),
			);
			await use(server);
			await new Promise<void>((resolve) => server.agent.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
		{ scope: "worker" },
	],

	// How many tracks the Library playlist holds. The captured 54 are enough for
	// anything about one screen of rows; past a few thousand the app behaves
	// differently -- rows arrive in chunks rather than one response, and scroll
	// offsets are computed over a list taller than any hand-written fixture.
	librarySize: [null, { option: true }],

	// How big the *media library* is, which is what `#/all` and search read on a
	// 0.11 player. Separate from `librarySize` above, which inflates an ordinary
	// playlist. The synthesised tracks deliberately do not sit in tag order:
	// their track numbers cycle independently of their paths, so the library's
	// path order and the player's browse order disagree -- which is the whole
	// point, because the captured fixture's folders match its tags and cannot
	// tell the two apart.
	mediaLibrarySize: [null, { option: true }],

	// The *shape* of the media library rather than its size:
	// test.use({ libraryShape: { tracks: 4, albums: 1, omit: ['%year%'] } }).
	// The capture is one tidy, mid-sized, thoroughly tagged collection, which is
	// exactly the library in which a bug about small, one-artist or untagged ones
	// cannot show up. Replaces the `#Jean Library` autoplaylist too, so both
	// sources still describe the same library. See `libraryOfShape`.
	//
	// A description rather than the built tracks, because an option's *top level*
	// does not survive the trip to the worker as an array -- it arrives as
	// `{0: ..., 1: ...}`, with no `.map` on it. Nested arrays are fine, which is
	// why `omit` inside the object works and a bare array of tracks would not.
	libraryShape: [null, { option: true }],

	// Everything except Jean's own, dropped. A player with no user playlists on
	// it at all is a fresh install, and nothing else reaches that state.
	withoutPlaylists: [false, { option: true }],

	// Title-formatting expressions this player cannot resolve, so a spec can ask
	// for a bare install: test.use({ withoutFields: ['%lastfm_play_count%'] }) is
	// foobar2000 with no playback-statistics component, and everything built on
	// play counts should disappear rather than break.
	withoutFields: [[], { option: true }],

	// Removes the playlist Jean resolves as the library, so the first-run path is
	// reachable. Nothing else can get there: an install that already has a
	// `#Jean Library` never sees the setup screen, and the capture always has one.
	withoutLibraryPlaylist: [false, { option: true }],

	// The media library's state, as beefweb 0.11+ reports it.
	// test.use({ library: { supported: false } }) is DeaDBeeF, where every
	// library endpoint answers 501; { enabled: false } is foobar2000 with no
	// media library configured. Both send Jean back to the autoplaylist, but for
	// different reasons and with different fixes.
	//
	// JEAN_NO_LIBRARY_API=1 runs the whole suite against the autoplaylist
	// fallback instead. The app is supposed to behave identically either way --
	// that is what the source seam is for -- so the same assertions should hold
	// with the data coming from somewhere else entirely.
	library: [
		process.env.JEAN_NO_LIBRARY_API ? { supported: false } : {},
		{ option: true },
	],

	// Whether this run has the media library API, for the handful of specs that
	// genuinely cannot assert the same thing both ways. Asked of the fixture
	// rather than of the environment, so there is one answer to the question and
	// a spec that pins `library` gets the right one.
	hasLibraryApi: async ({ library }, use) => {
		await use(library.supported !== false && library.enabled !== false);
	},

	// Tag values the capture does not carry, keyed by track title:
	// test.use({ retagged: { Bloodhail: { '%artist%': 'Have a Nice Life feat. X' } } }).
	// The captured library has no featured artist and no compilation on it, and
	// both change what a row renders -- so a test states the tag rather than the
	// fixture growing an invented album for it.
	retagged: [{}, { option: true }],

	// The optional tag-writing component and the states it can present; absent by
	// default. See `fake-api/fooJean.ts` and `test/README.md`.
	fooJean: [null, { option: true }],

	// Seeded into localStorage separately from `settings`, because the token may
	// never travel through beefweb's clientconfig.
	fooJeanToken: [null, { option: true }],

	// Overrides merged onto the captured player state, for the things that vary
	// between installs and are not in the fixture: permissions, the volume range,
	// which playback orders the player actually offers.
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
		// Drops the `#Jean Library` autoplaylist, which is the only thing that makes
		// Jean's library resolve on a player without the media library API -- so
		// this is the first run. The ordinary playlist called 'Library' stays, and
		// must not be mistaken for it.
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

	// Merged over SEEDED_SETTINGS above, so a spec names only what it changes.
	settings: [{}, { option: true }],

	// Nothing seeded at all, for the tests about a first run.
	firstRun: [false, { option: true }],

	// The app animates deliberately and without stopping: the play/pause toggle
	// layers scale and rotate on coprime durations for as long as something is
	// playing. Neither moves it, but both change its bounding box every frame,
	// and Playwright waits for a box that holds still across two frames before it
	// will click. Against a permanently moving target that wait can only time out
	// -- so the suite asks for the preference the app already honours in
	// tokens.css rather than forcing clicks past the checks that catch genuinely
	// unclickable elements.
	//
	// The cost is that these tests say nothing about the motion itself. A spec
	// that wants to assert on it opts out with test.use({ motion: 'allow' }).
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

// Re-exported so a spec writing a helper of its own has one place to import
// from, the same as it does for `test` and the locators below.
export type { Locator, Page } from "@playwright/test";
export { expect };

// ---- finding things on screen ----------------------------------------------

// The row the virtualiser has mounted for a given position in the view. Rows
// carry data-row, which is their index in the view rather than in the playlist
// -- the two differ the moment anything is filtered.
export const trackRow = (page: Page, index: number) =>
	page.locator(`[role="row"][data-row="${index}"]`);

export const rowByTitle = (page: Page, title: string) =>
	page.locator('[role="row"]').filter({ hasText: title }).first();

export const statusBar = (page: Page) => page.locator("footer");

export const viewHeader = (page: Page) => page.locator("main header").first();

export const sidebar = (page: Page) =>
	page.getByRole("navigation", { name: "Playlists" });

// On a phone the sidebar is a drawer -- display:none until asked for, and every
// route change closes it again. On a desktop it is simply there. The toggle's
// label cannot tell the two apart: it reads 'Show playlists' on a desktop as
// well, because `isSidebarOpen` is only the drawer's business and is false there
// too, so asking for it by name collapses a sidebar that was already open. Ask
// the sidebar itself instead.
export const openSidebar = async (page: Page) => {
	const home = sidebar(page).getByRole("button", { name: "Home" });
	if (await home.isVisible()) return;
	await page.getByRole("button", { name: "Show playlists" }).click();
	await expect(home).toBeVisible();
};

// The captured `Library` playlist, which most specs use simply as a list long
// enough to scroll. Not `#Jean Library`, which is Jean's own.
export const openLibrary = async (page: Page) => {
	await page.goto("/#/p7");
	await expect(
		page.getByRole("heading", { level: 1, name: "Library" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

// ---- reading the player -----------------------------------------------------

// What the app sent, so a test can assert on the wire rather than only on the
// screen. Reads the fake's own log, not the browser's.
export const requestsTo = (player: FakePlayer, pattern: string) =>
	player.requests.filter((entry) => entry.path.includes(pattern));

// The playlist Jean materialises to play a set from. Found by the prefix rather
// than by a title, because the title is named for whichever set filled it.
export const scratchOf = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title.startsWith("#Jean ["));

// The last thing the player was told to play.
// '' / api / player / play / {plref} / {index}
export const playedFrom = (player: FakePlayer) => {
	const play = requestsTo(player, "/player/play/").at(-1);
	if (!play) return null;
	const [, , , , plref, index] = play.path.split("/");
	return { plref, index: Number(index) };
};

// The track that request actually names, resolved through the playlist it names
// it in. The whole class of bug here is that a position and a track agree on a
// number and disagree on a song, so nothing short of resolving it says anything.
export const trackPlayed = (player: FakePlayer) => {
	const at = playedFrom(player);
	if (!at) return null;
	const playlist = player.playlists.find((entry) => entry.id === at.plref);
	return playlist?.items[at.index]?.["%title%"] ?? null;
};

// ---- gestures ---------------------------------------------------------------

// Press-and-hold, which is touch's right-click. Dispatched rather than driven by
// page.touchscreen, which has no way to hold -- and the synthetic click at the
// end is part of the gesture rather than scaffolding: a hold that stopped
// swallowing it would also activate whatever it opened the menu over.
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

// Whether a row is actually on screen, which is not the same question as
// whether it rendered: overscan deliberately mounts rows past the fold, and an
// album group is tall enough that its rows can be mounted while sitting well
// below the viewport. Measured against the scroll container, the same way
// TrackList decides which way the "Now playing" pill points.
//
// The tolerance is not slack, it is the unit the browser works in. Row heights,
// the scroll offset and the container's own rect are all fractional, so a row
// scrolled exactly to the bottom edge lands a few tenths of a pixel past it.
// Asserting exact containment fails on geometry nobody can see.
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

// The virtualiser only mounts what is near the viewport, so a row further down
// a playlist does not exist to be located until the list has been scrolled to
// it. A screenful at a time rather than a jump to the end: the row wanted is as
// often in the middle as at the bottom, and in album mode the total height is an
// estimate until the groups have been measured, so any single jump is aimed at
// the wrong place anyway.
export const scrollUntilMounted = async (page: Page, locator: Locator) => {
	// Wait for the view before scrolling it. Without this the poll below starts
	// against an empty list, scrolls a container with nothing in it to scroll,
	// and spends its whole budget before the rows have even arrived -- which is
	// why it failed only in a full parallel run and never on its own.
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
export const inSequence = <T>(
	items: T[],
	run: (item: T, index: number) => unknown,
) =>
	items.reduce<Promise<unknown>>(
		(done, item, index) => done.then(() => run(item, index)),
		Promise.resolve(),
	);

export const times = (count: number, run: (index: number) => unknown) =>
	inSequence(
		Array.from({ length: count }, (_, index) => index),
		run,
	);
