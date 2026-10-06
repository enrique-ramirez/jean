import {
	albumRoute,
	artistRoute,
	genreRoute,
} from "../../src/domain/track/routes.ts";
import { PROBE_TIMEOUT_MS } from "../../src/shared/api/client.ts";
import type { DetachedSession } from "../fake-api/sessions.ts";
import { evaluate, type Track } from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	closeNowPlaying,
	countPostsToSession,
	coversFromTheComponent,
	dragFrom,
	dragTo,
	drawing,
	expect,
	expectDisabledWithReason,
	expectNothingRefusedSent,
	expectSettlesAt,
	guidOfPlaylist,
	isRowOnScreen,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSettings,
	openSidebar,
	playedFrom,
	playingOn,
	pressAndHold,
	REASON,
	REFUSED_ROUTES,
	requestsTo,
	revealSearch,
	rowByTitle,
	scratchOf,
	searchField,
	searchFor,
	settingsDialog,
	sidebar,
	statusBar,
	test,
	toasts,
	tokenColourIn,
	trackRow,
	untilQuiet,
	untilTheInstallIsKnown,
	viewHeader,
	withNoListOnScreen,
} from "./fixtures.ts";
import { openPanels, panelTab } from "./nowPlaying.ts";

// ---- a page in a session ----------------------------------------------------

const DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";
const ANOTHER_DEVICE = {
	deviceId: "0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a",
	name: null,
};

const SESSION_KEY = "jean.session";

// Search before anything is searched for draws no list of tracks, so a title on screen there is one
// a playing surface drew.
const ROUTE_WITH_NO_LIST = "/#/search";

// An install that offers sessions, and a browser whose device id is known before the page loads,
// so a session can be made as this device.
const IN_SESSIONS = {
	fooJean: { maxSessions: 4, canCreateSessions: true },
	settings: { "jean.deviceId": DEVICE },
};

const LYRIC_TAG = "$meta(unsynced lyrics)";
const SESSION_LYRIC = "Every word here belongs to the session's track";
const PLAYER_LYRIC = "Every word here belongs to the player's track";

const field = (track: Track, expression: string) =>
	String(evaluate(track, expression) ?? "");

const titleOf = (track: Track) => field(track, "%title%");

const lengthOf = (track: Track) => Number(field(track, "%length_seconds%"));

// One track off each record the library holds, so no two roles below share a title, a length or a
// cover, and no surface can agree with the session by drawing the player's.
const castOf = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const records = new Map<string, Track>();
	for (const track of library) {
		const record = field(track, "%album%");
		if (!records.has(record)) records.set(record, track);
	}
	const [
		atThePlayer,
		inTheSession,
		nextInTheSession,
		queuedInTheSession,
		queuedAtThePlayer,
	] = records.values();
	if (!queuedAtThePlayer)
		throw new Error("the library holds fewer than five records");
	return {
		atThePlayer,
		inTheSession,
		nextInTheSession,
		queuedInTheSession,
		queuedAtThePlayer,
		rowOf: (track: Track) => library.indexOf(track),
	};
};

type Cast = ReturnType<typeof castOf>;

interface Scene {
	cast: Cast;
	session: DetachedSession;
}

// The player plays one record and the session another, each with a queue of its own. A session
// nobody hears reads `paused`, so `heard` puts another device's connection on it. `sessionLyric`
// tags the session's track alone.
const setTheScene = (
	player: FakePlayer,
	{
		heard = false,
		queued = false,
		lyrics = false,
		sessionLyric,
	}: {
		heard?: boolean;
		queued?: boolean;
		lyrics?: boolean;
		sessionLyric?: string;
	} = {},
): Scene => {
	const cast = castOf(player);

	player.playItem("p7", cast.rowOf(cast.atThePlayer));
	if (lyrics) player.retagPlaying({ [LYRIC_TAG]: PLAYER_LYRIC });
	if (queued)
		player.queueInsert([{ playlistId: "p7", track: cast.queuedAtThePlayer }]);

	const session = player.sessions.create({ deviceId: DEVICE, name: null });
	const lyric = lyrics ? SESSION_LYRIC : sessionLyric;
	const playing =
		lyric === undefined
			? cast.inTheSession
			: { ...cast.inTheSession, [LYRIC_TAG]: lyric };
	session.play([playing, cast.nextInTheSession], 0);
	if (queued)
		session.queueInsert([{ playlistId: null, track: cast.queuedInTheSession }]);
	if (heard) player.addSessionListener(session.id, ANOTHER_DEVICE);

	return { cast, session };
};

// Playwright runs a page's init scripts again on every reload, so the marker keeps a reload from
// writing back a value the page itself changed or removed.
const storeForThisTab = (page: Page, value: unknown) =>
	page.addInitScript(
		({ key, stored }) => {
			if (sessionStorage.getItem("test.stored")) return;
			sessionStorage.setItem("test.stored", "1");
			sessionStorage.setItem(
				key,
				typeof stored === "string" ? stored : JSON.stringify(stored),
			);
		},
		{ key: SESSION_KEY, stored: value },
	);

const storedForThisTab = (page: Page) =>
	page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);

// Strict mode answers `500` to any session-scoped request naming no session, so a page in a session
// that sends one is caught here whatever it was for.
const refusalsFrom = (page: Page) => {
	const refused: string[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (response.status() === 500 && url.pathname.startsWith("/api/"))
			refused.push(`${response.request().method()} ${url.pathname}`);
	});
	return refused;
};

const openInSession = async (
	page: Page,
	player: FakePlayer,
	session: DetachedSession,
	{ listening = false }: { listening?: boolean } = {},
) => {
	await storeForThisTab(page, { id: session.id, listening });
	const refused = refusalsFrom(page);
	player.fooJean.strictSessions = true;
	await page.goto(ROUTE_WITH_NO_LIST);
	await expect.poll(() => statePolls(player).length).toBeGreaterThan(0);
	return refused;
};

// Every piece of text the page ever put in front of a person, the tab's title included, checked for
// the watched strings at each change rather than once at the end.
const watchFor = (page: Page, watched: string[]) =>
	page.addInitScript((texts) => {
		const shown = new Set<string>();
		Object.assign(window, { textShown: shown });
		const look = () => {
			const now = document.documentElement?.textContent ?? "";
			for (const text of texts) if (now.includes(text)) shown.add(text);
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, watched);

const everShown = (page: Page) =>
	page.evaluate(() => [
		...(window as unknown as { textShown: Set<string> }).textShown,
	]);

interface Scope {
	session: string | null;
	deviceId: string | null;
}

const scopeIn = (path: string): Scope => {
	const query = new URL(path, "http://fake").searchParams;
	return { session: query.get("session"), deviceId: query.get("deviceId") };
};

const statePolls = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.split("?")[0] === "/api/state",
		)
		.map((entry) => scopeIn(entry.path));

// Read off the page's own requests, for a case with two pages on one fake.
const statePollsSentBy = (page: Page) => {
	const sent: Scope[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (request.method() === "GET" && url.pathname === "/api/state")
			sent.push(scopeIn(url.pathname + url.search));
	});
	return sent;
};

const inThe = (session: DetachedSession): Scope => ({
	session: session.id,
	deviceId: DEVICE,
});

const ON_THE_PLAYER: Scope = { session: null, deviceId: null };

const tabTitle = (page: Page) => page.title();

const seekBar = (page: Page) =>
	statusBar(page).getByRole("slider", { name: "Position" });

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const queueRows = (page: Page) => queuePanel(page).getByRole("listitem");

// On a phone the status bar has no queue button and the now-playing screen carries it.
const openQueue = async (page: Page) => {
	const inTheBar = statusBar(page).getByRole("button", { name: /^Queue/ });
	if (await inTheBar.count()) await inTheBar.click();
	else {
		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", { name: /^Queue/ })
			.click();
	}
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
};

const expectQueueShows = (page: Page, titles: string[]) =>
	expect
		.poll(() => queueRows(page).allTextContents())
		.toEqual(titles.map((title) => expect.stringContaining(title)));

// Sampled tightly, so the count of polls taken when a change first shows is the count it needed
// rather than the count the sampling waited through.
const pollsUntil = async (
	player: FakePlayer,
	shown: () => Promise<boolean>,
) => {
	const from = statePolls(player).length;
	await expect.poll(shown, { intervals: [50], timeout: 10_000 }).toBe(true);
	return statePolls(player).length - from;
};

// ---- the poll ---------------------------------------------------------------

test.describe("the state poll of a tab in a session", () => {
	test.use(IN_SESSIONS);

	test("names the stored session and this device, from the first poll the page sends", async ({
		page,
		player,
	}) => {
		const { session } = setTheScene(player);
		const refused = await openInSession(page, player, session);

		await expect.poll(() => statePolls(player).length).toBeGreaterThan(2);

		const polls = statePolls(player);
		expect(polls[0]).toEqual(inThe(session));
		expect(polls.filter((poll) => poll.session !== session.id)).toEqual([]);
		expect(polls.filter((poll) => poll.deviceId !== DEVICE)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("names neither a session nor a device where nothing is stored", async ({
		page,
		player,
	}) => {
		setTheScene(player);
		await withNoListOnScreen(page);

		await expect.poll(() => statePolls(player).length).toBeGreaterThan(2);

		expect(
			statePolls(player).filter(
				(poll) => poll.session !== null || poll.deviceId !== null,
			),
		).toEqual([]);
	});
});

// ---- the surfaces -----------------------------------------------------------

test.describe("every surface of a tab in a session follows the session, not the player", () => {
	test.use(IN_SESSIONS);

	test("the status bar and the tab's title name the session's track, and never the player's", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		await watchFor(page, [titleOf(cast.atThePlayer)]);
		const refused = await openInSession(page, player, session);

		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await expect
			.poll(() => tabTitle(page))
			.toContain(titleOf(cast.inTheSession));
		await expect(seekBar(page)).toHaveAttribute(
			"aria-valuemax",
			String(lengthOf(cast.inTheSession)),
		);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the now-playing screen shows the session's track, and never the player's", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		await watchFor(page, [titleOf(cast.atThePlayer)]);
		const refused = await openInSession(page, player, session);

		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await openNowPlaying(page);
		await expect(nowPlayingScreen(page)).toContainText(
			titleOf(cast.inTheSession),
		);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the queue panel lists the session's queue and counts down the session's track, and never the player's", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, {
			heard: true,
			queued: true,
		});
		await watchFor(page, [titleOf(cast.queuedAtThePlayer)]);
		const refused = await openInSession(page, player, session);

		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await openQueue(page);
		await expectQueueShows(page, [titleOf(cast.queuedInTheSession)]);

		// The countdown is the session's track's length less its position, and the session's track is
		// far shorter than the player's.
		const remaining = queuePanel(page).getByText(/left of this track$/);
		await expect(remaining).toBeVisible();
		const [minutes, seconds] = ((await remaining.textContent()) ?? "")
			.split(" ")[0]
			.split(":")
			.map(Number);
		expect(minutes * 60 + seconds).toBeLessThanOrEqual(
			lengthOf(cast.inTheSession),
		);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the lyrics panel shows the session's track's lyric, and never the player's", async ({
		page,
		player,
		isMobile,
	}) => {
		const { cast, session } = setTheScene(player, {
			heard: true,
			lyrics: true,
		});
		await watchFor(page, [PLAYER_LYRIC]);
		const refused = await openInSession(page, player, session);

		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText(SESSION_LYRIC);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});
});

// ---- a change made elsewhere ------------------------------------------------

test.describe("a change another device makes to the session reaches the tab within one poll", () => {
	test.use(IN_SESSIONS);

	// One poll asked after the change carries it. The second allows for one that went out while
	// the page was drawing the first.
	const ONE_POLL_AND_ONE_IN_FLIGHT = 2;

	test("a skip moves the status bar and the tab's title to the next track", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));

		const next = titleOf(cast.nextInTheSession);
		session.next();

		const polls = await pollsUntil(
			player,
			async () =>
				((await statusBar(page).textContent()) ?? "").includes(next) &&
				(await tabTitle(page)).includes(next),
		);
		expect(polls).toBeLessThanOrEqual(ONE_POLL_AND_ONE_IN_FLIGHT);
		expect(refused).toEqual([]);
	});

	test("an entry queued in the session appears in the queue panel", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(0);

		const queued = titleOf(cast.queuedInTheSession);
		session.queueInsert([{ playlistId: null, track: cast.queuedInTheSession }]);

		const polls = await pollsUntil(player, async () =>
			(await queueRows(page).allTextContents()).some((row) =>
				row.includes(queued),
			),
		);
		expect(polls).toBeLessThanOrEqual(ONE_POLL_AND_ONE_IN_FLIGHT);
		expect(refused).toEqual([]);
	});
});

// ---- leaving ----------------------------------------------------------------

test.describe("a session that ends under the tab gives the tab back to the player", () => {
	test.use(IN_SESSIONS);

	// Far apart, and each past the other's track length, so a position drawn from the wrong one
	// cannot fall in the right one's range.
	const SESSION_AT = 20;
	const PLAYER_AT = 200;

	const endedScene = (player: FakePlayer) => {
		const scene = setTheScene(player, { queued: true });
		scene.session.seek({ seconds: SESSION_AT });
		player.patchPlayer({ position: PLAYER_AT, playbackState: "paused" });
		// Equal revisions are the point: a queue held by revision alone would not be read again.
		expect(scene.session.queueRevision).toBe(player.queueRevision);
		expect(PLAYER_AT).toBeGreaterThan(lengthOf(scene.cast.inTheSession));
		return scene;
	};

	const endUnderThePage = async (
		player: FakePlayer,
		session: DetachedSession,
	) => {
		// A page back on the player names no session by design.
		player.fooJean.strictSessions = false;
		player.endSession(session.id);
		await expect.poll(() => statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
	};

	test("the status bar, the tab's title, the position and the cover are the player's", async ({
		page,
		player,
	}) => {
		const { cast, session } = endedScene(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		const position = async () =>
			Number(await seekBar(page).getAttribute("aria-valuenow"));
		await expect.poll(position).toBeGreaterThanOrEqual(SESSION_AT);
		expect(await position()).toBeLessThanOrEqual(lengthOf(cast.inTheSession));
		expect(refused).toEqual([]);

		await endUnderThePage(player, session);

		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		await expect(statusBar(page)).not.toContainText(titleOf(cast.inTheSession));
		await expect
			.poll(() => tabTitle(page))
			.toContain(titleOf(cast.atThePlayer));
		await expect(seekBar(page)).toHaveAttribute(
			"aria-valuemax",
			String(lengthOf(cast.atThePlayer)),
		);
		await expect.poll(position).toBeGreaterThanOrEqual(PLAYER_AT);
		await expect
			.poll(() => coversFromTheComponent(player))
			.toContain(player.libraryPathFor(cast.atThePlayer));
	});

	test("the queue panel lists the player's queue though both queues stood at one revision", async ({
		page,
		player,
	}) => {
		const { cast, session } = endedScene(player);
		await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await openQueue(page);
		await expectQueueShows(page, [titleOf(cast.queuedInTheSession)]);

		await endUnderThePage(player, session);

		await expectQueueShows(page, [titleOf(cast.queuedAtThePlayer)]);
	});
});

test.describe("a stored session the player does not hold", () => {
	test.use(IN_SESSIONS);

	test("puts the tab on the player, removes the stored value, and stops naming it", async ({
		page,
		player,
	}) => {
		const { cast } = setTheScene(player);
		const STALE = "no-longer-held";
		await storeForThisTab(page, { id: STALE, listening: false });
		await page.goto(ROUTE_WITH_NO_LIST);

		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		await expect.poll(() => storedForThisTab(page)).toBeNull();

		const named = () =>
			statePolls(player).filter((poll) => poll.session === STALE).length;
		const namedOnce = named();
		const from = statePolls(player).length;
		await expect
			.poll(() => statePolls(player).length)
			.toBeGreaterThan(from + 2);
		expect(named()).toBe(namedOnce);
		expect(statePolls(player).slice(from)).toEqual(
			statePolls(player)
				.slice(from)
				.map(() => ON_THE_PLAYER),
		);
	});
});

// ---- across a reload and a second tab ---------------------------------------

test.describe("a tab that was listening to a session, loaded again", () => {
	test.use(IN_SESSIONS);

	const STREAM_ROUTES = new Set([
		"POST /api/stream/ticket",
		"GET /api/stream",
		"POST /api/stream/leave",
	]);

	const streamAsks = (player: FakePlayer) =>
		player.requests
			.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`)
			.filter((route) => STREAM_ROUTES.has(route));

	test("sends no ticket, opens no stream, sends no leave, and keeps the stored value across a reload", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player);
		const stored = { id: session.id, listening: true };
		const refused = await openInSession(page, player, session, {
			listening: true,
		});
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await expectSettlesAt(player, () => streamAsks(player), []);

		await page.reload();
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));

		expect(JSON.parse((await storedForThisTab(page)) ?? "null")).toEqual(
			stored,
		);
		expect(statePolls(player).at(-1)).toEqual(inThe(session));
		await expectSettlesAt(player, () => streamAsks(player), []);
		expect(refused).toEqual([]);
	});
});

test.describe("a second tab of the same browser", () => {
	test.use(IN_SESSIONS);

	test("opens on the player while the first tab stays in its session", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player);
		const firstTabPolls = statePollsSentBy(page);
		await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));

		// The second tab is on the player, whose requests name no session by design.
		player.fooJean.strictSessions = false;
		const second = await page.context().newPage();
		const secondTabPolls = statePollsSentBy(second);
		await withNoListOnScreen(second);

		await expect(statusBar(second)).toContainText(titleOf(cast.atThePlayer));
		expect(await storedForThisTab(second)).toBeNull();
		const firstFrom = firstTabPolls.length;
		await expect.poll(() => secondTabPolls.length).toBeGreaterThan(2);
		await expect.poll(() => firstTabPolls.length).toBeGreaterThan(firstFrom);

		expect(secondTabPolls.filter((poll) => poll.session !== null)).toEqual([]);
		expect(firstTabPolls.filter((poll) => poll.session !== session.id)).toEqual(
			[],
		);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
	});
});

// ---- the playing cover ------------------------------------------------------

// Without a library the playing track has no record to be addressed by, and its cover is asked for
// at the playing route, the one cover address the session governs.
test.describe("the playing cover of a tab in a session, with no library to address it by", () => {
	test.use({
		...IN_SESSIONS,
		fooJean: { ...IN_SESSIONS.fooJean, canReadLibrary: false },
	});

	test("is asked for naming the session and this device", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));

		const coverAsks = () =>
			requestsTo(player, "/api/artwork/playing")
				.filter((entry) => entry.method === "GET")
				.map((entry) => scopeIn(entry.path));
		await expect.poll(() => coverAsks().length).toBeGreaterThan(0);
		await expectSettlesAt(
			player,
			() =>
				coverAsks().filter(
					(scope) => scope.session !== session.id || scope.deviceId !== DEVICE,
				),
			[],
		);
		expect(refused).toEqual([]);
	});
});

// ---- playback control off ---------------------------------------------------

// The player's owner has turned `controlPlayback` off. `contract/openapi.yaml` never refuses a
// detached session for it, so everything below reaches the session, and the player's own session
// keeps every refusal it had.
const CONTROL_OFF = {
	...IN_SESSIONS,
	fooJean: { ...IN_SESSIONS.fooJean, canControlPlayback: false },
};

const REASON_LINE = "Playback control is off.";

const PLAY_PAUSE = /^(Play|Pause)\b/;
const PREVIOUS = /^Previous track\b/;
const NEXT = /^Next track\b/;
const ORDER = /^Playback order\b/;
const POSITION = /^Playback position\b/;
const SEEK_BACK = /^Seek back 5 seconds/;
const SEEK_FORWARD = /^Seek forward 5 seconds/;

const PLAY_PAUSE_ROUTE = "POST /api/playback/play-pause";
const NEXT_ROUTE = "POST /api/playback/next";
const PREVIOUS_ROUTE = "POST /api/playback/previous";
const STOP_ROUTE = "POST /api/playback/stop";
const SEEK_ROUTE = "POST /api/playback/seek";

const button = (scope: Locator, name: RegExp) =>
	scope.getByRole("button", { name });

const slider = (scope: Locator, name: RegExp) =>
	scope.getByRole("slider", { name });

// The mirror of `expectDisabledWithReason`: drawn, live, and named for what it does rather than
// for why it cannot.
const expectOffered = async (control: Locator) => {
	await expect(control).toBeVisible();
	await expect(control).not.toHaveAttribute("aria-disabled", "true");
	await expect(control).toBeEnabled();
	await expect(control).not.toHaveAccessibleName(REASON);
};

// Every command a player with `controlPlayback` off refuses, as `METHOD /path`, sent naming that
// session, or naming none where `session` is null: `contract/openapi.yaml` reads no session as the
// player's own.
const commandsNaming = (player: FakePlayer, session: string | null) =>
	player.requests
		.filter((entry) => {
			const route = `${entry.method} ${entry.path.split("?")[0]}`;
			const named = scopeIn(entry.path).session;
			return (
				REFUSED_ROUTES.some((pattern) => pattern.test(route)) &&
				(named === "engine" ? null : named) === session
			);
		})
		.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);

const tally = (routes: string[]) =>
	routes.reduce<Record<string, number>>((counts, route) => {
		counts[route] = (counts[route] ?? 0) + 1;
		return counts;
	}, {});

const expectSessionSent = (
	player: FakePlayer,
	session: DetachedSession,
	expected: Record<string, number>,
) =>
	expectSettlesAt(
		player,
		() => tally(commandsNaming(player, session.id)),
		expected,
	);

// What the player itself is doing: none of it may move while the tab drives its session.
const heldAtThePlayer = (player: FakePlayer) => ({
	item: { ...player.player.activeItem },
	playback: player.player.playbackState,
	queued: player.queuedEntries().map((entry) => titleOf(entry.track)),
});

const expectThePlayerUntouched = async (
	player: FakePlayer,
	before: ReturnType<typeof heldAtThePlayer>,
) => {
	await expectSettlesAt(player, () => commandsNaming(player, null), []);
	expect(heldAtThePlayer(player)).toEqual(before);
};

const sessionPlays = (session: DetachedSession) => {
	const track = session.playingTrack();
	return track ? titleOf(track) : null;
};

const libraryTitle = (player: FakePlayer, row: number) => {
	const track = player.playlistById("p7")?.items[row];
	if (!track) throw new Error(`the library has no row ${row}`);
	return titleOf(track);
};

// A control session-scoped requests reach once the page is in its session, so a key pressed before
// the transport is drawn live is not lost.
const inSessionWithControlOff = async (
	page: Page,
	player: FakePlayer,
	options: Parameters<typeof setTheScene>[1] = {},
) => {
	const scene = setTheScene(player, { heard: true, ...options });
	const refused = await openInSession(page, player, scene.session);
	await expect(statusBar(page)).toContainText(titleOf(scene.cast.inTheSession));
	await untilQuiet(player);
	return { ...scene, refused, before: heldAtThePlayer(player) };
};

const pressFromTheBody = async (page: Page, keys: readonly string[]) => {
	// Space on a focused button presses the button.
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
	for (const key of keys) await page.keyboard.press(key);
};

test.describe("with playback control off, the transport of a tab in a session of its own", () => {
	test.use(CONTROL_OFF);

	test("the status bar's transport is live and named for what it does, each press reaches the session, and the player moves nowhere", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		const bar = statusBar(page);

		const pressed = isMobile
			? [button(bar, PLAY_PAUSE)]
			: [button(bar, PREVIOUS), button(bar, PLAY_PAUSE), button(bar, NEXT)];
		const position = slider(bar, POSITION);
		const drawn = isMobile
			? [...pressed, position]
			: [button(bar, ORDER), ...pressed, position];
		for (const control of drawn) await expectOffered(control);

		for (const control of pressed) await control.click();
		await position.click();

		await expectSessionSent(
			player,
			session,
			isMobile
				? { [PLAY_PAUSE_ROUTE]: 1, [SEEK_ROUTE]: 1 }
				: {
						[PREVIOUS_ROUTE]: 1,
						[PLAY_PAUSE_ROUTE]: 1,
						[NEXT_ROUTE]: 1,
						[SEEK_ROUTE]: 1,
					},
		);
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("the now-playing screen's transport is live and named for what it does, and each press reaches the session", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the screen draws a transport only on a phone; on a desktop the status bar is it",
		);

		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);

		const pressed = [
			button(screen, PREVIOUS),
			button(screen, PLAY_PAUSE),
			button(screen, NEXT),
		];
		for (const control of [
			button(screen, ORDER),
			...pressed,
			slider(screen, POSITION),
		])
			await expectOffered(control);

		for (const control of pressed) await control.click();

		await expectSessionSent(player, session, {
			[PREVIOUS_ROUTE]: 1,
			[PLAY_PAUSE_ROUTE]: 1,
			[NEXT_ROUTE]: 1,
		});
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test('"Playback control is off." is drawn nowhere, in the status bar, the now-playing screen or the queue panel', async ({
		page,
		player,
	}) => {
		await watchFor(page, [REASON_LINE]);
		const { refused } = await inSessionWithControlOff(page, player, {
			queued: true,
		});

		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(1);
		await openNowPlaying(page);
		await untilQuiet(player);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the transport keys reach the session, and the player moves nowhere", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");

		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		// The keys and the button share one gate, and a key pressed before it opens is dropped.
		await expectOffered(button(statusBar(page), PLAY_PAUSE));

		await pressFromTheBody(page, [
			"ArrowRight",
			"ArrowLeft",
			"Space",
			"ControlOrMeta+ArrowRight",
			"ControlOrMeta+ArrowLeft",
			"ControlOrMeta+.",
		]);

		await expectSessionSent(player, session, {
			[SEEK_ROUTE]: 2,
			[PLAY_PAUSE_ROUTE]: 1,
			[NEXT_ROUTE]: 1,
			[PREVIOUS_ROUTE]: 1,
			[STOP_ROUTE]: 1,
		});
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	// Jean restarts a track itself past five seconds on the player, by seeking to 0. A session
	// restarts its own track, so the seek would be a second restart racing the session's.
	test("Previous well past five seconds into the session's track sends previous to the session, and no seek", async ({
		page,
		player,
		isMobile,
	}) => {
		const PAST_FIVE_SECONDS = 20;
		const scene = setTheScene(player, { heard: true });
		expect(lengthOf(scene.cast.inTheSession)).toBeGreaterThan(
			PAST_FIVE_SECONDS,
		);
		scene.session.seek({ seconds: PAST_FIVE_SECONDS });
		const refused = await openInSession(page, player, scene.session);
		await expect
			.poll(async () =>
				Number(await seekBar(page).getAttribute("aria-valuenow")),
			)
			.toBeGreaterThanOrEqual(PAST_FIVE_SECONDS);

		if (isMobile) await openNowPlaying(page);
		const previous = button(
			isMobile ? nowPlayingScreen(page) : statusBar(page),
			PREVIOUS,
		);
		await expectOffered(previous);
		await previous.click();

		await expectSessionSent(player, scene.session, { [PREVIOUS_ROUTE]: 1 });
		await expectSettlesAt(
			player,
			() =>
				player.requests.filter(
					(entry) =>
						`${entry.method} ${entry.path.split("?")[0]}` === SEEK_ROUTE,
				).length,
			0,
		);
		expect(refused).toEqual([]);
	});
});

test.describe("with playback control off and sessions offered, a tab on the player", () => {
	test.use(CONTROL_OFF);

	// The refusals `read-only-playback.spec.ts` pins hold on an install with no sessions; this is the
	// same tab on an install that offers them, with a session held, which must not loosen anything.
	test("keeps every transport control disabled with the reason, says why once, and neither a press nor a key sends anything", async ({
		page,
		player,
		isMobile,
	}) => {
		const { cast } = setTheScene(player, { heard: true });
		await withNoListOnScreen(page);
		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		const bar = statusBar(page);

		const controls = isMobile
			? [button(bar, PLAY_PAUSE), slider(bar, POSITION)]
			: [
					button(bar, ORDER),
					button(bar, PREVIOUS),
					button(bar, PLAY_PAUSE),
					button(bar, NEXT),
					slider(bar, POSITION),
				];
		for (const control of controls) await expectDisabledWithReason(control);
		const line = bar.getByText(REASON_LINE);
		await expect(line).toHaveCount(1);
		await expect(line).toBeVisible();

		for (const control of controls) await control.click({ force: true });
		if (!isMobile)
			await pressFromTheBody(page, [
				"Space",
				"ControlOrMeta+ArrowRight",
				"ControlOrMeta+ArrowLeft",
				"ControlOrMeta+.",
				"ArrowRight",
				"ArrowLeft",
			]);

		await expectNothingRefusedSent(player);
	});
});

// ---- the queue and the lyrics, with playback control off ------------------------

const SYNCED_LYRIC = [
	"[00:12.00]I never meant to",
	"[00:24.00]Dancing in the dark",
	"[01:20.00]And I don't mind",
].join("\r\n");

const LYRIC_FIELD = "unsynced lyrics";

const lyricsPanelOf = async (page: Page, isMobile: boolean) => {
	await openNowPlaying(page);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Lyrics").click();
	return panel;
};

test.describe("with playback control off, the queue panel of a tab in a session of its own", () => {
	test.use(CONTROL_OFF);

	// Three entries queued in the session and one at the player, so an edit reaching the wrong queue
	// changes one the test reads.
	const queuedScene = async (page: Page, player: FakePlayer) => {
		const scene = setTheScene(player, { heard: true });
		player.queueInsert([
			{ playlistId: "p7", track: scene.cast.queuedAtThePlayer },
		]);
		const queued = [1, 2, 3].map((row) => {
			const track = player.playlistById("p7")?.items[row];
			if (!track) throw new Error(`the library has no row ${row}`);
			return track;
		});
		scene.session.queueInsert(
			queued.map((track) => ({ playlistId: null, track })),
		);
		const refused = await openInSession(page, player, scene.session);
		await expect(statusBar(page)).toContainText(
			titleOf(scene.cast.inTheSession),
		);
		await openQueue(page);
		await expectQueueShows(page, queued.map(titleOf));
		await untilQuiet(player);
		return {
			...scene,
			titles: queued.map(titleOf),
			refused,
			before: heldAtThePlayer(player),
		};
	};

	const queuedInThe = (session: DetachedSession) =>
		session.queuedEntries().map((entry) => titleOf(entry.track));

	test("Remove takes the entry off the session's queue and Clear empties it, and the player's queue stays as it was", async ({
		page,
		player,
	}) => {
		const { session, titles, refused, before } = await queuedScene(
			page,
			player,
		);

		const remove = queueRows(page)
			.nth(1)
			.getByRole("button", { name: /^Remove .* from the queue/ });
		await expectOffered(remove);
		await remove.click();
		await expect
			.poll(() => queuedInThe(session))
			.toEqual([titles[0], titles[2]]);
		await expectQueueShows(page, [titles[0], titles[2]]);

		const clear = button(queuePanel(page), /^Clear\b/);
		await expectOffered(clear);
		await clear.click();
		await expect.poll(() => queuedInThe(session)).toEqual([]);
		await expect(queueRows(page)).toHaveCount(0);

		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("a row dragged up the panel moves it in the session's queue, and the player's queue stays as it was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a finger reorders through the grip, which queue.spec.ts holds as not yet working",
		);

		const { session, titles, refused, before } = await queuedScene(
			page,
			player,
		);

		const from = (await queueRows(page).nth(2).boundingBox())!;
		const to = (await queueRows(page).nth(0).boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, {
			steps: 12,
		});
		await page.mouse.up();

		await expect
			.poll(() => queuedInThe(session))
			.toEqual([titles[2], titles[0], titles[1]]);
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("a track dragged onto the queue button or over the open panel is taken, not refused", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");

		await inSessionWithControlOff(page, player);
		await openLibrary(page);
		const queueButton = statusBar(page).getByRole("button", { name: /^Queue/ });

		await queueButton.click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
		await dragFrom(page, trackRow(page, 0), queuePanel(page));
		await expect(page.locator("[data-armed]")).toBeVisible();
		await expect(page.locator("[data-refused]")).toHaveCount(0);
		await page.mouse.up();

		await queueButton.click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
		await dragFrom(page, trackRow(page, 0), queueButton);
		await expect(queueButton).toHaveAttribute("data-drop-over", "true");
		await expect(queueButton).not.toHaveAttribute("data-drop-refuses");
		await page.mouse.up();
	});
});

test.describe("with playback control off, the lyrics of a tab in a session of its own", () => {
	test.use({
		...CONTROL_OFF,
		fooJean: { ...CONTROL_OFF.fooJean, allowedFields: [LYRIC_FIELD] },
	});

	test("a line of a timed lyric is live, and pressing it seeks the session", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
			{ sessionLyric: SYNCED_LYRIC },
		);
		const panel = await lyricsPanelOf(page, isMobile);
		const line = button(panel, /Dancing in the dark/);

		await expectOffered(line);
		await line.click();

		await expectSessionSent(player, session, { [SEEK_ROUTE]: 1 });
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("the lyric editor's transport is live and reaches the session, and its keys list the playback keys", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
			{ sessionLyric: SYNCED_LYRIC },
		);
		const panel = await lyricsPanelOf(page, isMobile);
		await panel.getByRole("button", { name: "Edit", exact: true }).click();
		const editor = page.getByRole("dialog", {
			name: "Edit lyrics",
			exact: true,
		});
		await expect(editor).toBeVisible();

		const transport = [
			button(editor, SEEK_BACK),
			editor.getByRole("button", { name: /^(Play|Pause)($| \()/ }),
			button(editor, SEEK_FORWARD),
		];
		for (const control of transport) await expectOffered(control);
		for (const control of transport) await control.click();
		if (!isMobile) {
			await expect(
				editor.getByRole("complementary", { name: "Keys" }),
			).toContainText("Play from 2 s before the line");
			await pressFromTheBody(page, ["Space"]);
		}

		await expectSessionSent(player, session, {
			[SEEK_ROUTE]: 2,
			[PLAY_PAUSE_ROUTE]: isMobile ? 1 : 2,
		});
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});
});

test.describe("full-screen lyrics with playback control off", () => {
	test.use(CONTROL_OFF);
	test.skip(
		({ isMobile }) => isMobile,
		"a phone's Lyrics layer is already full screen, and the arrows are keys",
	);

	const openFullScreen = async (page: Page) => {
		const panel = nowPlayingScreen(page);
		await openNowPlaying(page);
		await panelTab(panel, "Lyrics").click();
		await page.getByRole("button", { name: "Full-screen lyrics" }).click();
		await expect(page.getByRole("region", { name: "Lyrics" })).toBeVisible();
	};

	test("in a session of the tab's own, the arrows seek the session", async ({
		page,
		player,
	}) => {
		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
			{ sessionLyric: SYNCED_LYRIC },
		);
		await openFullScreen(page);

		await pressFromTheBody(page, ["ArrowRight", "ArrowLeft"]);

		await expectSessionSent(player, session, { [SEEK_ROUTE]: 2 });
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("on the player, the arrows send nothing", async ({ page, player }) => {
		const { cast } = setTheScene(player, { heard: true });
		player.retagPlaying({ [LYRIC_TAG]: SYNCED_LYRIC });
		await withNoListOnScreen(page);
		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		await openFullScreen(page);

		await pressFromTheBody(page, ["ArrowRight", "ArrowLeft"]);

		await expectNothingRefusedSent(player);
	});
});

// ---- playing and queueing, with playback control off ------------------------

const sidebarPlaylist = (page: Page, title: string) =>
	sidebar(page)
		.getByRole("button")
		.filter({ has: page.getByText(title, { exact: true }) });

const playlistTitle = (player: FakePlayer, key: string) => {
	const title = player.playlistById(key)?.title;
	if (!title) throw new Error(`the fixture has no ${key}`);
	return title;
};

test.describe("with playback control off, playing and queueing in a tab in a session of its own", () => {
	test.use(CONTROL_OFF);

	test("activating a track row plays it in the session, and the player moves nowhere", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		await openLibrary(page);

		if (isMobile) await trackRow(page, 2).tap();
		else await trackRow(page, 2).dblclick();
		await expect
			.poll(() => sessionPlays(session))
			.toBe(libraryTitle(player, 2));

		if (!isMobile) {
			await trackRow(page, 4).click();
			await page.keyboard.press("Enter");
			await expect
				.poll(() => sessionPlays(session))
				.toBe(libraryTitle(player, 4));
		}

		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("a track's menu offers Add to queue, live and named for what it does", async ({
		page,
		player,
		isMobile,
	}) => {
		const { refused } = await inSessionWithControlOff(page, player);
		await openLibrary(page);
		if (isMobile) await pressAndHold(page, trackRow(page, 0));
		else await trackRow(page, 0).click({ button: "right" });

		const item = page.getByRole("menuitem", { name: /^Add to queue/ });
		await expectOffered(item);
		await expect(item).toHaveAccessibleName("Add to queue");
		expect(refused).toEqual([]);
	});

	test("Play and Shuffle are live on Home, All music, search results and an artist, and so is Home's album card", async ({
		page,
		player,
	}) => {
		const { refused } = await inSessionWithControlOff(page, player);
		const expectHeaderOffers = async () => {
			await expectOffered(button(viewHeader(page), /^Play\b/));
			await expectOffered(button(viewHeader(page), /^Shuffle\b/));
		};

		await page.goto("/");
		await expectHeaderOffers();
		await expectOffered(
			page
				.getByRole("region", { name: "Explore" })
				.getByRole("button", { name: /Jessico/ }),
		);

		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectHeaderOffers();

		await searchFor(page, "babasonicos");
		await expectHeaderOffers();

		const artist = "Babasónicos";
		await page.goto(`/#/artist/${encodeURIComponent(artist)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: artist }),
		).toBeVisible();
		await expectHeaderOffers();

		expect(refused).toEqual([]);
	});

	test("P plays the list from its first track in the session", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");

		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		await openLibrary(page);
		// The key and the header's Play share one gate, and a key pressed before it opens is dropped.
		await expectOffered(button(viewHeader(page), /^Play\b/));
		await trackRow(page, 4).click();
		await page.keyboard.press("p");

		await expect
			.poll(() => sessionPlays(session))
			.toBe(libraryTitle(player, 0));
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("a playlist double-clicked in the sidebar plays in the session", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "a double-click plays only under a fine pointer");

		const { session, refused, before } = await inSessionWithControlOff(
			page,
			player,
		);
		const first = player.playlistById("p1")?.items[0];
		if (!first) throw new Error("p1 is empty in the fixture");
		expect(titleOf(first)).not.toBe(sessionPlays(session));

		await openLibrary(page);
		await sidebarPlaylist(page, playlistTitle(player, "p1")).dblclick();

		await expect.poll(() => sessionPlays(session)).toBe(titleOf(first));
		await expectThePlayerUntouched(player, before);
		expect(refused).toEqual([]);
	});

	test("Settings still names the switch the player's owner turns playback control on with", async ({
		page,
		player,
	}) => {
		await inSessionWithControlOff(page, player);
		await openSettings(page);

		await expect(
			settingsDialog(page)
				.getByRole("region", { name: "foo_jean" })
				.locator("p")
				.filter({ hasText: /control ?playback/i }),
		).toBeVisible();
	});
});

test.describe("with playback control off and sessions offered, playing from a tab on the player", () => {
	test.use(CONTROL_OFF);
	test.skip(
		({ isMobile }) => isMobile,
		"P is a key and a double-click plays only under a fine pointer",
	);

	test("P plays nothing and sends nothing", async ({ page, player }) => {
		setTheScene(player, { heard: true });
		await openLibrary(page);
		await expectDisabledWithReason(button(viewHeader(page), /^Play\b/));
		await trackRow(page, 4).click();
		await page.keyboard.press("p");

		await expectNothingRefusedSent(player);
	});

	test("a playlist double-clicked in the sidebar plays nothing and sends nothing", async ({
		page,
		player,
	}) => {
		setTheScene(player, { heard: true });
		await openLibrary(page);
		await sidebarPlaylist(page, playlistTitle(player, "p1")).dblclick();

		await expectNothingRefusedSent(player);
	});
});

// ---- playing into a session -------------------------------------------------

const PLAY_SET_PATH = "/api/playback/play";
const PLAY_SET_ROUTE = `POST ${PLAY_SET_PATH}`;
const MODE_ROUTE = "POST /api/playback/mode";
const SCRATCH_FILL_PATH = "/api/playlists/own/scratch/items";

const pathOf = (track: Track) => field(track, "%path%");

// Every playlist's rows, the scratch's among them, the player's own playback, order and queue, and
// every command sent naming no session.
const everythingThePlayerHolds = (player: FakePlayer) => ({
	playlists: player.playlists.map((playlist) => ({
		id: playlist.id,
		title: playlist.title,
		rows: playlist.items.map(pathOf),
	})),
	item: { ...player.player.activeItem },
	playback: player.player.playbackState,
	order: player.player.playbackMode,
	queued: player
		.queuedEntries()
		.map((entry) => `${entry.playlistId}:${pathOf(entry.track)}`),
	commands: commandsNaming(player, null).length,
});

const expectThePlayerHolds = (
	player: FakePlayer,
	before: ReturnType<typeof everythingThePlayerHolds>,
) => expectSettlesAt(player, () => everythingThePlayerHolds(player), before);

const routeOf = (entry: { method: string; path: string }) =>
	`${entry.method} ${entry.path.split("?")[0]}`;

// Anything that would create, fill, empty or edit a playlist, the scratch included.
const playlistWritesSince = (player: FakePlayer, from: number) =>
	player.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method !== "GET" && entry.path.startsWith("/api/playlists"),
		)
		.map(routeOf);

const setsSentTo = (player: FakePlayer, session: DetachedSession) =>
	player.requests
		.filter(
			(entry) =>
				routeOf(entry) === PLAY_SET_ROUTE &&
				scopeIn(entry.path).session === session.id,
		)
		.map((entry) => entry.body ?? {});

// An ordinal set read the way `foo_jean` reads a fill: `ordinals` in the order given, `runs` and
// `bitset` ascending, a bitset's lowest bit first.
const ordinalsIn = (set: Record<string, unknown>): number[] => {
	if (Array.isArray(set.ordinals)) return set.ordinals as number[];
	if (Array.isArray(set.runs))
		return (set.runs as [number, number][]).flatMap(([start, count]) =>
			Array.from({ length: count }, (_, at) => start + at),
		);
	if (typeof set.bitset === "string") {
		const bytes = Uint8Array.from(atob(set.bitset), (char) =>
			char.charCodeAt(0),
		);
		const held: number[] = [];
		bytes.forEach((byte, at) => {
			for (let bit = 0; bit < 8; bit += 1)
				if (byte & (1 << bit)) held.push(at * 8 + bit);
		});
		return held;
	}
	throw new Error(`no ordinal set in ${JSON.stringify(set)}`);
};

const tracksIn = (player: FakePlayer, set: Record<string, unknown>) => {
	const library = player.ordinalOrder();
	return ordinalsIn(set).map((ordinal) => library[ordinal]?.track);
};

const pathPlayedBy = (session: DetachedSession) => {
	const track = session.playingTrack();
	return track ? pathOf(track) : null;
};

const queuedInTheSession = (session: DetachedSession) =>
	session.queuedEntries().map((entry) => titleOf(entry.track));

// What the same press plays on the player: the rows it filled the scratch with, and the row it
// started at.
const whatThePlayerPlays = async (player: FakePlayer) => {
	await expect
		.poll(() => {
			const scratch = scratchOf(player);
			const at = playedFrom(player);
			return Boolean(
				scratch && at && at.id === scratch.guid && scratch.items[at.index],
			);
		})
		.toBe(true);
	await untilQuiet(player);
	const scratch = scratchOf(player);
	const at = playedFrom(player);
	if (!scratch || !at) throw new Error("the player played nothing from a set");
	return {
		rows: scratch.items.map(pathOf),
		started: pathOf(scratch.items[at.index]),
	};
};

// From a page on the player to the same page in a session of its own. Through a blank page, so
// nothing the page sent on the player is still in flight once strict mode is on.
const intoTheSession = async (
	page: Page,
	player: FakePlayer,
	session: DetachedSession,
) => {
	await page.goto("about:blank");
	const refused = await openInSession(page, player, session);
	await expect.poll(() => statePolls(player).at(-1)).toEqual(inThe(session));
	return refused;
};

const headerButton = (page: Page, name: string) =>
	viewHeader(page).getByRole("button", { name, exact: true });

const pressWhenOffered = async (control: Locator) => {
	await expect(control).toBeEnabled();
	await control.click();
};

const activate = (row: Locator, isMobile: boolean) =>
	isMobile ? row.tap() : row.dblclick();

const ARTIST = "Babasónicos";
const RECORD = /^Jessico/;
const GENRE = "Post Rock";
const QUERY = "babasonicos";

const albumCard = (page: Page) =>
	page.getByRole("region", { name: "Explore" }).getByRole("button", {
		name: RECORD,
	});

// Home by its own route: the root opens the now-playing screen while the player plays a row.
const openHome = async (page: Page) => {
	await page.goto("/#/home");
	await expect(headerButton(page, "Play")).toBeVisible();
};

const openArtist = async (page: Page) => {
	await page.goto(`/#/${artistRoute(ARTIST)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: ARTIST }),
	).toBeVisible();
};

const openGenre = async (page: Page) => {
	await page.goto(`/#/${genreRoute(GENRE)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: GENRE }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

const openResults = async (page: Page) => {
	await page.goto("/#/search");
	await searchFor(page, QUERY);
	await expect(trackRow(page, 0)).toBeAttached();
};

interface SetPress {
	name: string;
	needsAKeyboard?: boolean;
	// Shuffle starts at a row drawn at random, on the player as in a session.
	startsAnywhere?: boolean;
	open: (page: Page) => Promise<void>;
	press: (page: Page, isMobile: boolean) => Promise<void>;
}

// Each place Jean plays a set from. Jessico is not first on Most played, and the result is the third,
// so two of these start past the set's first track.
const SET_PRESSES: SetPress[] = [
	{
		name: "an album card on Home",
		open: async (page) => {
			await openHome(page);
			await expect(albumCard(page)).toBeVisible();
		},
		press: (page) => pressWhenOffered(albumCard(page)),
	},
	{
		name: "a record on an artist's page",
		open: openArtist,
		press: (page) =>
			pressWhenOffered(
				page.locator("main").getByRole("button", { name: RECORD }),
			),
	},
	{
		name: "an artist's Play",
		open: openArtist,
		press: (page) => pressWhenOffered(headerButton(page, "Play")),
	},
	{
		name: "a genre's Play",
		open: openGenre,
		press: (page) => pressWhenOffered(headerButton(page, "Play")),
	},
	{
		name: "a search's Play",
		open: openResults,
		press: (page) => pressWhenOffered(headerButton(page, "Play")),
	},
	{
		name: "a search result activated",
		open: openResults,
		press: (page, isMobile) => activate(trackRow(page, 2), isMobile),
	},
	{
		name: "All music's Play",
		open: openAllMusic,
		press: (page) => pressWhenOffered(headerButton(page, "Play")),
	},
	{
		name: "P in All music",
		needsAKeyboard: true,
		open: openAllMusic,
		press: async (page) => {
			// The key and the header's Play share one gate, and a key pressed before it opens is dropped.
			await expect(headerButton(page, "Play")).toBeEnabled();
			await trackRow(page, 4).click();
			await page.keyboard.press("p");
		},
	},
	{
		name: "Home's Shuffle",
		startsAnywhere: true,
		open: openHome,
		press: (page) => pressWhenOffered(headerButton(page, "Shuffle")),
	},
];

test.describe("playing a set from a tab in a session of its own", () => {
	test.use(IN_SESSIONS);

	for (const press of SET_PRESSES)
		test(`${press.name} sends one set play naming the session, holding the tracks and the start the player gets, and writes no playlist`, async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(
				Boolean(press.needsAKeyboard) && isMobile,
				"no keyboard on the phone",
			);
			// Nothing plays in the session yet, so no list draws a row of it that a follow could scroll to.
			player.playItem("p7", 0);
			const session = player.sessions.create({ deviceId: DEVICE, name: null });
			player.addSessionListener(session.id, ANOTHER_DEVICE);

			// The same press on the player first, which is what the session's set is held to.
			await press.open(page);
			await press.press(page, isMobile);
			const onThePlayer = await whatThePlayerPlays(player);

			const refused = await intoTheSession(page, player, session);
			await press.open(page);
			await untilQuiet(player);
			const before = everythingThePlayerHolds(player);
			const from = player.requests.length;

			await press.press(page, isMobile);

			await expectSettlesAt(
				player,
				() => countPostsToSession(player, PLAY_SET_PATH, session.id),
				1,
			);
			const [set] = setsSentTo(player, session);
			expect(set.structure).toBe(player.libraryFeed.structure);
			const rows = tracksIn(player, set);
			expect(rows.map(pathOf)).toEqual(onThePlayer.rows);
			if (press.startsAnywhere) {
				expect(set.index).toBeGreaterThanOrEqual(0);
				expect(set.index).toBeLessThan(rows.length);
			} else expect(pathOf(rows[set.index])).toBe(onThePlayer.started);
			await expect
				.poll(() => pathPlayedBy(session))
				.toBe(pathOf(rows[set.index]));

			// Whether Shuffle also sets the session's order is not this case's to say.
			const commands = commandsNaming(player, session.id).filter(
				(route) => !(press.startsAnywhere && route === MODE_ROUTE),
			);
			expect(tally(commands)).toEqual({ [PLAY_SET_ROUTE]: 1 });
			expect(playlistWritesSince(player, from)).toEqual([]);
			await expectThePlayerHolds(player, before);
			expect(refused).toEqual([]);
		});

	test("activating a row of a playlist sends one row play naming the session, and nothing the player holds moves", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session } = setTheScene(player, { heard: true });
		const refused = await openInSession(page, player, session);
		await openLibrary(page);
		await untilQuiet(player);
		const before = everythingThePlayerHolds(player);

		await activate(trackRow(page, 2), isMobile);

		await expectSessionSent(player, session, {
			[`POST /api/playlists/${guidOfPlaylist(player, "p7")}/items/2/play`]: 1,
		});
		await expect
			.poll(() => sessionPlays(session))
			.toBe(libraryTitle(player, 2));
		await expectThePlayerHolds(player, before);
		expect(refused).toEqual([]);
	});
});

// Every toast the page ever raised, by what it said, however soon it went.
const watchTheToasts = (page: Page) =>
	page.addInitScript(() => {
		const raised = new Set<string>();
		Object.assign(window, { toastsRaised: raised });
		const look = () => {
			for (const dismiss of document.querySelectorAll(
				'[role="status"] button[aria-label="Dismiss"]',
			))
				raised.add(dismiss.parentElement?.textContent ?? "");
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	});

const toastsRaised = (page: Page) =>
	page.evaluate(() =>
		[
			...(window as unknown as { toastsRaised: Set<string> }).toastsRaised,
		].sort(),
	);

// The library rebuilt between the page reading it and the request reaching the player, once, so
// the request carries a `structure` the player has moved past.
const rebuildUnder = (page: Page, player: FakePlayer, path: string) =>
	page.route(
		(url) => url.pathname === path,
		async (route) => {
			player.libraryFeed.building = [...player.libraryFeed.columns];
			player.finishLibraryBuild();
			await route.fallback();
		},
		{ times: 1 },
	);

const statusesFrom = (page: Page, path: string) => {
	const answered: number[] = [];
	page.on("response", (response) => {
		if (new URL(response.url()).pathname === path)
			answered.push(response.status());
	});
	return answered;
};

test.describe("a set play refused for a library that moved under it", () => {
	test.use(IN_SESSIONS);

	test("leaves the session as it was, says what the same refusal says on the player, and fills nothing instead", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, {
			heard: true,
			queued: true,
		});
		await watchTheToasts(page);

		await openAllMusic(page);
		const filled = statusesFrom(page, SCRATCH_FILL_PATH);
		await rebuildUnder(page, player, SCRATCH_FILL_PATH);
		await pressWhenOffered(headerButton(page, "Play"));
		await expect.poll(() => filled).toEqual([409]);
		await untilQuiet(player);
		const saidOnThePlayer = await toastsRaised(page);

		const refused = await intoTheSession(page, player, session);
		await openAllMusic(page);
		await untilQuiet(player);
		const before = everythingThePlayerHolds(player);
		const queued = queuedInTheSession(session);
		const from = player.requests.length;

		const played = statusesFrom(page, PLAY_SET_PATH);
		await rebuildUnder(page, player, PLAY_SET_PATH);
		await pressWhenOffered(headerButton(page, "Play"));
		await expect.poll(() => played[0]).toBe(409);
		await untilQuiet(player);

		expect(sessionPlays(session)).toBe(titleOf(cast.inTheSession));
		expect(queuedInTheSession(session)).toEqual(queued);
		expect(playlistWritesSince(player, from)).toEqual([]);
		await expectThePlayerHolds(player, before);
		expect(await toastsRaised(page)).toEqual(saidOnThePlayer);
		expect(refused).toEqual([]);
	});
});

test.describe("adding to the queue from a tab in a session of its own", () => {
	test.use(IN_SESSIONS);

	test("Add to queue from a track's menu puts the track in the session's queue, and the player's queue stays as it was", async ({
		page,
		player,
		isMobile,
	}) => {
		const { cast, session } = setTheScene(player, {
			heard: true,
			queued: true,
		});
		const added = player.playlistById("p7")?.items[3];
		if (!added) throw new Error("the library has no row 3");
		const refused = await openInSession(page, player, session);
		await openLibrary(page);
		await untilQuiet(player);
		const before = everythingThePlayerHolds(player);

		const row = trackRow(page, 3);
		await expect(row).toContainText(titleOf(added));
		if (isMobile) await pressAndHold(page, row);
		else await row.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Add to queue" }).click();

		await expect
			.poll(() => queuedInTheSession(session))
			.toEqual([titleOf(cast.queuedInTheSession), titleOf(added)]);
		await expectThePlayerHolds(player, before);
		expect(refused).toEqual([]);
	});

	test("a track dragged onto the open queue lands in the session's queue, and the player's queue stays as it was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");

		const { session } = setTheScene(player, { heard: true, queued: true });
		const refused = await openInSession(page, player, session);
		await openLibrary(page);
		await openQueue(page);
		await untilQuiet(player);
		const before = everythingThePlayerHolds(player);
		const queued = queuedInTheSession(session);

		await dragFrom(page, trackRow(page, 2), queuePanel(page));
		await page.mouse.up();

		await expect
			.poll(() => queuedInTheSession(session))
			.toEqual([...queued, libraryTitle(player, 2)]);
		await expectThePlayerHolds(player, before);
		expect(refused).toEqual([]);
	});
});

// ---- the scratch and the playing row ----------------------------------------

// The player plays from the scratch as a search Jean played on it left it: twelve rows, titled for
// the query. Made in the fake directly, since with playback control off Jean could not fill it.
const SCRATCH_ROWS = 12;

const playingFromTheScratch = (player: FakePlayer) => {
	const { id } = player.addPlaylist(`#Jean [search: ${QUERY}]`);
	player.fooJean.ownPlaylists.scratch = id;
	player.copyItems(
		"p7",
		id,
		Array.from({ length: SCRATCH_ROWS }, (_, row) => row),
	);
	player.playItem(id, 0);
	const scratch = player.playlistById(id);
	if (scratch?.items.length !== SCRATCH_ROWS)
		throw new Error("the scratch was not filled");
	return scratch;
};

for (const [control, options] of [
	["on", IN_SESSIONS],
	["off", CONTROL_OFF],
] as const)
	test.describe(`with playback control ${control}, a search dismissed in a stopped session of the tab's own`, () => {
		test.use(options);

		// The player's own half, a dismissed search emptying a scratch nothing plays from, is
		// search-playback.spec.ts's "empties the scratch once playback has stopped".
		test("sends nothing to the scratch, and leaves its rows whole while the player plays from it", async ({
			page,
			player,
		}) => {
			const scratch = playingFromTheScratch(player);
			const rows = scratch.items.map(pathOf);
			const session = player.sessions.create({ deviceId: DEVICE, name: null });
			const refused = await openInSession(page, player, session);
			await expect(statusBar(page)).toContainText("Nothing playing");

			await searchFor(page, "delectrico");
			await page.getByRole("button", { name: "Clear search" }).click();
			// The field emptying says the handler ran, so what follows is its decision rather than a race.
			await revealSearch(page);
			await expect(searchField(page)).toHaveValue("");

			await expectSettlesAt(
				player,
				() => requestsTo(player, "/api/playlists/own/").map(routeOf),
				[],
			);
			expect(scratch.items.map(pathOf)).toEqual(rows);
			expect(player.player.activeItem.playlistId).toBe(scratch.id);
			expect(player.player.playbackState).toBe("playing");
			expect(refused).toEqual([]);
		});
	});

// Every row ever drawn with the playing mark, and every sidebar row ever marked as playing from
// here, recorded as they are drawn rather than read once at the end.
const watchTheMarks = (page: Page) =>
	page.addInitScript(() => {
		const marked = { rows: new Set<string>(), playingFromHere: 0 };
		Object.assign(window, { marked });
		const look = () => {
			for (const row of document.querySelectorAll(
				'[role="row"][data-active="true"]',
			))
				marked.rows.add(row.textContent ?? "");
			if (document.querySelector('[aria-label="Playing from here"]'))
				marked.playingFromHere += 1;
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-active", "aria-label"],
		});
	});

const marksEverDrawn = (page: Page) =>
	page.evaluate(() => {
		const { marked } = window as unknown as {
			marked: { rows: Set<string>; playingFromHere: number };
		};
		return { rows: [...marked.rows], playingFromHere: marked.playingFromHere };
	});

const NOTHING_MARKED = { rows: [], playingFromHere: 0 };

// A session playing `playing` and then `next`, which another device listens to, so it reads playing.
const sessionPlaying = (player: FakePlayer, tracks: Track[], at = 0) => {
	const session = player.sessions.create({ deviceId: DEVICE, name: null });
	session.play(tracks, at);
	player.addSessionListener(session.id, ANOTHER_DEVICE);
	return session;
};

const libraryRow = (player: FakePlayer, row: number) => {
	const held = player.ordinalOrder()[row]?.track;
	if (!held) throw new Error(`the library has no ordinal ${row}`);
	return held;
};

const playlistRow = (player: FakePlayer, row: number) => {
	const held = player.playlistById("p7")?.items[row];
	if (!held) throw new Error(`the library has no row ${row}`);
	return held;
};

interface ListOfTracks {
	name: string;
	playing: (player: FakePlayer) => Track;
	open: (page: Page, playing: Track) => Promise<void>;
}

// Each list holds the session's track near its top, where it is drawn without a scroll.
const LISTS: ListOfTracks[] = [
	{
		name: "a playlist",
		playing: (player) => playlistRow(player, 1),
		open: (page) => openLibrary(page),
	},
	{
		name: "All music",
		playing: (player) => libraryRow(player, 1),
		open: (page) => openAllMusic(page),
	},
	{
		name: "an album's track list",
		playing: (player) => playlistRow(player, 1),
		open: async (page, playing) => {
			const album = field(playing, "%album%");
			await page.goto(
				`/#/${albumRoute(field(playing, "$if2(%album artist%,%artist%)"), album)}`,
			);
			await expect(
				page.getByRole("heading", { level: 1, name: album }),
			).toBeVisible();
		},
	},
	{
		name: "search results",
		playing: (player) => playlistRow(player, 1),
		open: (page, playing) => searchFor(page, titleOf(playing)),
	},
];

const playingFromAnArtistSet = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const rows = library.flatMap((track, row) =>
		field(track, "%artist%") === ARTIST ? [row] : [],
	);
	if (rows.length === 0) throw new Error(`the library holds no ${ARTIST}`);
	const { id } = player.addPlaylist(`#Jean [artist: ${ARTIST}]`);
	player.fooJean.ownPlaylists.scratch = id;
	player.copyItems("p7", id, rows);
	player.playItem(id, 0);
};

const sessionOfAnotherArtist = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const tracks = library.filter(
		(track) =>
			!JSON.stringify(track).toLowerCase().includes(QUERY) &&
			field(track, "%artist%") !== ARTIST,
	);
	if (tracks.length < 2)
		throw new Error(`the library holds too little besides ${ARTIST}`);
	return {
		playing: tracks[0],
		session: sessionPlaying(player, tracks.slice(0, 2)),
	};
};

const openInSessionAt = async (
	route: string,
	page: Page,
	player: FakePlayer,
	session: DetachedSession,
) => {
	await storeForThisTab(page, { id: session.id, listening: false });
	const refused = refusalsFrom(page);
	player.fooJean.strictSessions = true;
	await page.goto(route);
	return refused;
};

const sidebarRowNamed = (page: Page, name: string) =>
	sidebar(page)
		.getByRole("button")
		.filter({ has: page.getByText(name, { exact: true }) });

const untilTheSidebarIsDrawn = async (page: Page, player: FakePlayer) => {
	await openSidebar(page);
	await expect(sidebarRowNamed(page, "Favorites")).toBeVisible();
	await untilQuiet(player);
};

const palette = (page: Page) => page.getByRole("dialog", { name: "Go to" });

const paletteEntries = (page: Page) => palette(page).getByRole("option");

const openPalette = async (page: Page) => {
	await openLibrary(page);
	await page.keyboard.press("g");
	await expect(palette(page)).toBeVisible();
};

const everyPlaylistAndAllMusic = (player: FakePlayer) =>
	player.playlists.length;

const saveAsPlaylist = (page: Page) =>
	viewHeader(page).getByRole("button", { name: /Save as playlist/ });

test.describe("in a tab in a session of its own, while the player plays from a set Jean filled", () => {
	test.use(IN_SESSIONS);

	test("the sidebar draws no row for the player's set", async ({
		page,
		player,
	}) => {
		playingFromAnArtistSet(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));

		await untilTheSidebarIsDrawn(page, player);

		expect(await sidebarRowNamed(page, ARTIST).count()).toBe(0);
		expect(refused).toEqual([]);
	});

	test("on the player, the sidebar draws a row for the set it plays", async ({
		page,
		player,
	}) => {
		playingFromAnArtistSet(player);
		await withNoListOnScreen(page);

		await openSidebar(page);
		await expect(sidebarRowNamed(page, ARTIST)).toBeVisible();
	});

	test("the sidebar draws no search row named for the player's search", async ({
		page,
		player,
	}) => {
		playingFromTheScratch(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSessionAt("/#/home", page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));

		await untilTheSidebarIsDrawn(page, player);

		expect(await sidebarRowNamed(page, QUERY).count()).toBe(0);
		expect(refused).toEqual([]);
	});

	test("on the player, the sidebar draws the search it plays under its query", async ({
		page,
		player,
	}) => {
		playingFromTheScratch(player);
		await page.goto("/#/home");

		await openSidebar(page);
		await expect(sidebarRowNamed(page, QUERY)).toBeVisible();
	});

	test("the palette offers no entry for the player's set", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the palette is opened by a key, and a phone has none");

		playingFromAnArtistSet(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));

		await openPalette(page);
		await expect(
			paletteEntries(page).filter({ hasText: "Favorites" }),
		).toBeVisible();

		const entries = await paletteEntries(page).allTextContents();
		expect(entries).not.toContainEqual(expect.stringContaining(ARTIST));
		expect(entries).toHaveLength(everyPlaylistAndAllMusic(player));
		expect(refused).toEqual([]);
	});

	test("on the player, the palette offers the set it plays first", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the palette is opened by a key, and a phone has none");

		playingFromAnArtistSet(player);

		await openPalette(page);
		await expect(paletteEntries(page)).toHaveCount(
			everyPlaylistAndAllMusic(player) + 1,
		);
		await expect(paletteEntries(page).first()).toHaveText(
			new RegExp(`^${ARTIST}`),
		);
	});

	test("the search route, opened fresh, restores no search from the player's", async ({
		page,
		player,
	}) => {
		playingFromTheScratch(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));
		await untilTheSidebarIsDrawn(page, player);

		await revealSearch(page);
		await expect(searchField(page)).toHaveValue("");
		expect(
			await page.getByRole("heading", { level: 1, name: QUERY }).count(),
		).toBe(0);
		expect(await page.locator('main [role="row"]').count()).toBe(0);
		expect(refused).toEqual([]);
	});

	test("on the player, the search route opened fresh restores the search it plays", async ({
		page,
		player,
	}) => {
		playingFromTheScratch(player);
		await page.goto(ROUTE_WITH_NO_LIST);

		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
		await revealSearch(page);
		await expect(searchField(page)).toHaveValue(QUERY);
	});

	test("search results draw no Save as playlist", async ({ page, player }) => {
		playingFromTheScratch(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));

		await searchFor(page, QUERY);
		await expect(trackRow(page, 0)).toBeAttached();
		await expect(
			viewHeader(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
		await untilQuiet(player);

		expect(await saveAsPlaylist(page).count()).toBe(0);
		expect(refused).toEqual([]);
	});

	test("on the player, search results draw Save as playlist", async ({
		page,
		player,
	}) => {
		playingFromTheScratch(player);
		await page.goto("/#/home");

		await searchFor(page, QUERY);
		await expect(saveAsPlaylist(page)).toBeVisible();
	});

	test("the save key on search results opens nothing, then or once the session has ended", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the key needs a keyboard, and a phone has none");

		playingFromTheScratch(player);
		const { playing, session } = sessionOfAnotherArtist(player);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));
		await searchFor(page, QUERY);
		await expect(trackRow(page, 0)).toBeAttached();

		await searchField(page).click();
		await searchField(page).press("End");
		await page.keyboard.press("ControlOrMeta+s");
		await page.keyboard.press("x");
		await expect(searchField(page)).toHaveValue(`${QUERY}x`);
		await untilQuiet(player);

		const nameField = page.getByRole("textbox", { name: "Playlist name" });
		expect(await nameField.count()).toBe(0);
		expect(refused).toEqual([]);

		player.fooJean.strictSessions = false;
		player.endSession(session.id);
		await expect(saveAsPlaylist(page)).toBeVisible();
		await untilQuiet(player);

		expect(await nameField.count()).toBe(0);
		await expect(saveAsPlaylist(page)).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});
});

const watchTheRoute = (page: Page) =>
	page.addInitScript(() => {
		const visited = [location.hash];
		Object.assign(window, { routesVisited: visited });
		addEventListener("hashchange", () => visited.push(location.hash));
	});

const routesVisited = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { routesVisited: string[] }).routesVisited,
	);

test.describe("a tab in a session of its own, loaded at its root", () => {
	test.use(IN_SESSIONS);

	for (const [state, heard] of [
		["plays", true],
		["is paused on", false],
	] as const)
		test(`opens the now-playing screen on the track the session ${state}`, async ({
			page,
			player,
		}) => {
			const { cast, session } = setTheScene(player, { heard });
			const refused = await openInSessionAt("/", page, player, session);

			await expect(nowPlayingScreen(page)).toBeVisible();
			await expect(nowPlayingScreen(page)).toContainText(
				titleOf(cast.inTheSession),
			);
			expect(refused).toEqual([]);
		});

	test("stays at the root where the session has nothing playing, though the player plays", async ({
		page,
		player,
	}) => {
		setTheScene(player);
		const session = player.sessions.create({ deviceId: DEVICE, name: null });
		await watchTheRoute(page);
		const refused = await openInSessionAt("/", page, player, session);

		await expect(statusBar(page)).toContainText("Nothing playing");
		await expect
			.poll(
				() =>
					statePolls(player).filter(
						({ session: named }) => named === session.id,
					).length,
			)
			.toBeGreaterThan(2);
		await untilQuiet(player);

		expect(await routesVisited(page)).toEqual([""]);
		expect(await nowPlayingScreen(page).count()).toBe(0);
		expect(refused).toEqual([]);
	});
});

test.describe("the playing row, in a tab in a session of its own", () => {
	test.use(IN_SESSIONS);

	for (const list of LISTS)
		test(`${list.name} draws the session's track with no playing mark`, async ({
			page,
			player,
		}) => {
			const playing = list.playing(player);
			const session = sessionPlaying(player, [playing, libraryRow(player, 30)]);
			await watchTheMarks(page);
			const refused = await openInSession(page, player, session);
			await expect(statusBar(page)).toContainText(titleOf(playing));

			await list.open(page, playing);
			await expect(rowByTitle(page, titleOf(playing))).toBeVisible();
			await untilQuiet(player);

			expect(await marksEverDrawn(page)).toEqual(NOTHING_MARKED);
			expect(refused).toEqual([]);
		});

	test('"Playing from" is drawn nowhere, in the status bar, the now-playing screen or the sidebar, while the player plays from a set Jean filled', async ({
		page,
		player,
	}) => {
		const scratch = playingFromTheScratch(player);
		const playing = scratch.items[1];
		const session = sessionPlaying(player, [playing, libraryRow(player, 30)]);
		await watchFor(page, ["Playing from"]);
		await watchTheMarks(page);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(playing));

		await openNowPlaying(page);
		await expect(nowPlayingScreen(page)).toContainText(titleOf(playing));
		await closeNowPlaying(page);
		await openSidebar(page);
		await expect(
			sidebar(page).getByRole("button", { name: "Home" }),
		).toBeVisible();
		await untilQuiet(player);

		expect(await everShown(page)).toEqual([]);
		expect((await marksEverDrawn(page)).playingFromHere).toBe(0);
		expect(refused).toEqual([]);
	});

	test("the cover wheel draws the session's sleeve and no neighbour", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(!isMobile, "the wheel is the phone's skip gesture");

		const { atThePlayer, inTheSession, nextInTheSession } = castOf(player);
		// Three records, so a neighbour drawn either side would be a sleeve of its own.
		const session = sessionPlaying(
			player,
			[atThePlayer, inTheSession, nextInTheSession],
			1,
		);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(inTheSession));

		await openNowPlaying(page);
		const wheel = nowPlayingScreen(page).locator("[data-cover-wheel]");
		await expect(
			wheel.locator("[data-current] [data-artwork]"),
		).toHaveAttribute("data-artwork", "ok");
		await expectSettlesAt(
			player,
			() => wheel.locator("[data-artwork='ok']").count(),
			1,
		);
		expect(refused).toEqual([]);
	});

	test("an entry in the session's queue draws its own title and artist, and counts in the total", async ({
		page,
		player,
	}) => {
		const { inTheSession } = castOf(player);
		const queued = [libraryRow(player, 5), libraryRow(player, 7)];
		const session = sessionPlaying(player, [inTheSession]);
		session.queueInsert(queued.map((track) => ({ playlistId: null, track })));
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(inTheSession));

		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(2);
		for (const [at, track] of queued.entries()) {
			await expect(queueRows(page).nth(at)).toContainText(titleOf(track));
			await expect(queueRows(page).nth(at)).toContainText(
				field(track, "%artist%"),
			);
		}
		await expect(queuePanel(page)).not.toContainText(/skipped/i);
		await expect(queuePanel(page)).toContainText("2 tracks");
		expect(refused).toEqual([]);
	});
});

// Where the view came to rest, watched frame by frame from inside the page.
const restingScrollTop = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				const scroller = document.querySelector("main") as HTMLElement;
				const until = performance.now() + 500;
				let last = Number.NaN;
				let still = 0;
				const tick = () => {
					const now = scroller.scrollTop;
					still = now === last ? still + 1 : 0;
					last = now;
					if (still >= 10 && performance.now() >= until) resolve(now);
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
	);

const FAR_IN_THE_LIBRARY = 40;

test.describe("with Cursor follows playback on, All music in a tab in a session of its own", () => {
	test.use({
		...IN_SESSIONS,
		settings: { ...IN_SESSIONS.settings, "jean.followPlayback": true },
	});

	test("stays where it was when the session moves to a track far down the list", async ({
		page,
		player,
	}) => {
		const far = libraryRow(player, FAR_IN_THE_LIBRARY);
		const session = sessionPlaying(player, [libraryRow(player, 1), far]);
		const refused = await openInSession(page, player, session);
		await openAllMusic(page);
		await expect.poll(() => isRowOnScreen(page, 0)).toBe(true);
		expect(await isRowOnScreen(page, FAR_IN_THE_LIBRARY)).toBe(false);

		session.next();
		await expect(statusBar(page)).toContainText(titleOf(far));

		expect(await restingScrollTop(page)).toBe(0);
		expect(await isRowOnScreen(page, FAR_IN_THE_LIBRARY)).toBe(false);
		expect(refused).toEqual([]);
	});
});

// Whether the status bar ever named `title`, recorded as it is drawn: a list on screen may name it
// all along.
const watchTheStatusBarFor = (page: Page, title: string) =>
	page.addInitScript((watched) => {
		const named = { shown: false };
		Object.assign(window, { statusBarNamed: named });
		new MutationObserver(() => {
			if (document.querySelector("footer")?.textContent?.includes(watched))
				named.shown = true;
		}).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, title);

const statusBarEverNamed = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { statusBarNamed: { shown: boolean } })
				.statusBarNamed.shown,
	);

const PLAY_ROUTES = [
	/^POST \/api\/playback\/play$/,
	/^POST \/api\/playlists\/[^/]+\/items\/\d+\/play$/,
	/^(POST|DELETE) \/api\/playlists\/own\//,
];

const playsSince = (player: FakePlayer, from: number) =>
	player.requests
		.slice(from)
		.map(routeOf)
		.filter((route) => PLAY_ROUTES.some((pattern) => pattern.test(route)));

test.describe("with Playback follows cursor on, All music in a tab in a session of its own", () => {
	test.use({
		...IN_SESSIONS,
		settings: {
			...IN_SESSIONS.settings,
			"jean.playbackFollowsCursor": true,
			"jean.followPlayback": false,
		},
	});

	// On the player the setting plays the cursor's row once the playing track moves on, which is
	// settings.spec.ts's "the next track is the row the cursor is on".
	test("plays nothing when the session moves on with the cursor on another row", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a tap plays the row it lands on, so the cursor cannot sit apart",
		);

		const next = libraryRow(player, 3);
		const session = sessionPlaying(player, [libraryRow(player, 2), next]);
		await watchTheStatusBarFor(page, titleOf(next));
		const refused = await openInSession(page, player, session);
		await openAllMusic(page);
		await trackRow(page, 5).click();
		await expect(trackRow(page, 5)).toHaveAttribute("data-cursor", "true");
		await untilQuiet(player);
		const from = player.requests.length;

		session.next();
		// Named at all, however briefly, is the poll carrying the move having landed.
		await expect.poll(() => statusBarEverNamed(page)).toBe(true);

		await expectSettlesAt(player, () => playsSince(player, from), []);
		expect(sessionPlays(session)).toBe(titleOf(next));
		expect(refused).toEqual([]);
	});
});

const DEVICE_NAME = "Den laptop";

const OFFERING_SESSIONS = {
	fooJean: { maxSessions: 4, canCreateSessions: true },
	settings: { "jean.deviceId": DEVICE, "jean.deviceName": DEVICE_NAME },
};

const PLAYER_NAME = "foobar2000";
const START = "Play something else here";
const START_DETAIL = `${PLAYER_NAME} carries on as it is.`;
const LISTENING_HERE = "Listening here";
const LEAVE_NAMED = `Leave, and go back to ${PLAYER_NAME}`;
const ONLY_LISTENER = "Only this device is listening, so leaving ends it.";
const STARTED_HERE = `Playing what ${DEVICE_NAME} started`;
const THIS_DEVICE = "This device";
const ON_THE_PLAYER_NAME = "Choose where to play";

const opener = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /^(Choose where to play|Playing on this device|Playing what .+ started)/,
	});

const openPicker = async (page: Page) => {
	await opener(page).click();
	await expect(playingOn(page)).toBeVisible();
};

const rows = (page: Page) =>
	playingOn(page).getByRole("listitem").and(page.locator("li:not(li li)"));

const playerRowOf = (page: Page) =>
	rows(page).filter({ has: page.getByText(PLAYER_NAME, { exact: true }) });

const ownRow = (page: Page) => rows(page).filter({ hasText: THIS_DEVICE });

const startButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: START, exact: true });

const leaveButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: LEAVE_NAMED, exact: true });

const thePlayersFace = (page: Page) =>
	playingOn(page).getByRole("button", { name: "Listen here", exact: true });

const waysOut = (scope: Locator) =>
	scope.getByRole("button", {
		name: /^(Leave\b|Stop\b|Stop listening here)/,
	});

// WAI-ARIA reads `aria-current="false"` as not current, the same as no attribute.
const currentRows = (page: Page) =>
	rows(page).and(page.locator('[aria-current]:not([aria-current="false"])'));

const startedBy = (player: FakePlayer) => {
	const [started, ...more] = player.sessions.list();
	if (!started || more.length > 0)
		throw new Error(`the fake holds ${player.sessions.list().length} sessions`);
	return started;
};

const thePlayerPlays = (player: FakePlayer) => {
	const cast = castOf(player);
	player.playItem("p7", cast.rowOf(cast.atThePlayer));
	return cast;
};

const howItPlays = (session: DetachedSession) => ({
	track: sessionPlays(session),
	playback: session.playback(),
	position: session.position,
});

const listensIn = (session: DetachedSession) =>
	session.roster().some((device) => device.deviceId === DEVICE);

const connectionsIn = (session: DetachedSession) =>
	session.roster().find((device) => device.deviceId === DEVICE)?.connections ??
	0;

const postsTo = (player: FakePlayer, route: string) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path.split("?")[0] === route,
	);

const streamsOpened = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" && entry.path.split("?")[0] === "/api/stream",
	).length;

const strictOnceSettled = async (player: FakePlayer) => {
	await untilQuiet(player);
	player.fooJean.strictSessions = true;
	return {
		release() {
			player.fooJean.strictSessions = false;
		},
	};
};

const browserSaw = (page: Page) => {
	const seen: string[] = [];
	const routeOf = (request: { method: () => string; url: () => string }) =>
		`${request.method()} ${new URL(request.url()).pathname}`;
	page.on("response", (response) => {
		if (routeOf(response.request()) === "POST /api/sessions")
			seen.push("created");
	});
	page.on("request", (request) => {
		const route = routeOf(request);
		if (route === "POST /api/stream/ticket") seen.push("ticket");
		if (route === "POST /api/stream/leave") seen.push("leave");
		if (route === "GET /api/stream") seen.push("stream");
	});
	const letGo = (request: { method: () => string; url: () => string }) => {
		if (routeOf(request) === "GET /api/stream") seen.push("stream closed");
	};
	page.on("requestfailed", letGo);
	page.on("requestfinished", letGo);
	return seen;
};

const openOnThePlayer = async (page: Page) => {
	const refused = refusalsFrom(page);
	await page.goto(ROUTE_WITH_NO_LIST);
	await expect(opener(page)).toBeVisible();
	return refused;
};

const startHere = async (page: Page, player: FakePlayer) => {
	await openPicker(page);
	await expect(startButton(page)).toBeVisible();
	await startButton(page).click();
	await expect.poll(() => player.sessions.list().length).toBe(1);
	const started = startedBy(player);
	await expect.poll(() => listensIn(started)).toBe(true);
	return started;
};

const inStartedSession = async (page: Page, player: FakePlayer) => {
	const refused = await openOnThePlayer(page);
	const started = await startHere(page, player);
	const strict = await strictOnceSettled(player);
	return { strict, refused, started };
};

const PAST_THE_SECOND_LEAVE_MS = 3_000;

test.describe("the start row, where sessions are offered", () => {
	test.use(OFFERING_SESSIONS);

	test(`is the picker's last row, a button reading "${START}" over "${START_DETAIL}", with the player's row still first`, async ({
		page,
		player,
	}) => {
		await openOnThePlayer(page);
		await openPicker(page);

		await expect(rows(page)).toHaveCount(2);
		await expect(
			rows(page).first().getByText(PLAYER_NAME, { exact: true }),
		).toBeVisible();
		await expect(rows(page).last().getByRole("button")).toHaveAccessibleName(
			START,
		);
		await expect(rows(page).last()).toContainText(START_DETAIL);
		await expect(startButton(page)).toBeVisible();
		await untilQuiet(player);
		expect(player.sessions.list()).toEqual([]);
	});
});

test.describe("the start row, where the install lets no session be created", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { maxSessions: 4, canCreateSessions: false },
	});

	test("is not drawn, and the picker holds the player's row alone", async ({
		page,
		player,
	}) => {
		await openOnThePlayer(page);
		await untilTheInstallIsKnown(player);
		await openPicker(page);

		await expect(thePlayersFace(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await expect(playingOn(page).getByText(START)).toHaveCount(0);
		await expect(playingOn(page).getByText(START_DETAIL)).toHaveCount(0);
	});
});

test.describe("the start row, where the install cannot stream", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { maxSessions: 4, canCreateSessions: true, canStream: false },
	});

	test("is nowhere, since the picker is not drawn at all", async ({
		page,
		player,
	}) => {
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(statusBar(page)).toBeVisible();
		await untilTheInstallIsKnown(player);

		await expect(opener(page)).toHaveCount(0);
		await expect(page.getByText(START)).toHaveCount(0);
	});
});

test.describe("starting from the picker", () => {
	test.use(OFFERING_SESSIONS);

	test("sends one create carrying this device's id and name, then one ticket naming what it made, and opens the stream in it", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		const order = browserSaw(page);

		const started = await startHere(page, player);
		const strict = await strictOnceSettled(player);

		await expectSettlesAt(
			player,
			() => postsTo(player, "/api/sessions").map((entry) => entry.body),
			[{ deviceId: DEVICE, name: DEVICE_NAME }],
		);
		expect(postsTo(player, "/api/stream/ticket").length).toBe(1);
		expect(countPostsToSession(player, "/api/stream/ticket", started.id)).toBe(
			1,
		);
		expect(postsTo(player, "/api/stream/ticket")[0].body).toMatchObject({
			deviceId: DEVICE,
		});
		expect(
			order.filter((step) => step !== "stream closed").slice(0, 3),
		).toEqual(["created", "ticket", "stream"]);
		expect(listensIn(started)).toBe(true);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("puts the page in what it started: its poll names it and this device, and the tab keeps it as listening", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);

		await expect.poll(() => statePolls(player).at(-1)).toEqual(inThe(started));
		await expect
			.poll(async () => JSON.parse((await storedForThisTab(page)) ?? "null"))
			.toEqual({ id: started.id, listening: true });
		strict.release();
		expect(refused).toEqual([]);
	});

	test("sends nothing to the player and moves nothing it holds", async ({
		page,
		player,
	}) => {
		const cast = thePlayerPlays(player);
		const refused = await openOnThePlayer(page);
		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		await untilQuiet(player);
		const before = heldAtThePlayer(player);

		await startHere(page, player);
		const strict = await strictOnceSettled(player);

		await expectThePlayerUntouched(player, before);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("leaves the picker open, the desktop's popover and the phone's sheet alike", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(leaveButton(page)).toBeVisible();
		await untilQuiet(player);
		await expect(playingOn(page)).toBeVisible();
		if (isMobile)
			await expect(
				page.getByRole("dialog", { name: "Playing on" }),
			).toBeVisible();
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("starting from the picker while the create is slow to answer", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: {
			...OFFERING_SESSIONS.fooJean,
			routeLatency: { "POST /api/sessions": { ms: 1_000 } },
		},
	});

	test("a second press before the answer sends no second create", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await openPicker(page);

		await startButton(page).click();
		await expect.poll(() => postsTo(player, "/api/sessions").length).toBe(1);
		await startButton(page).click();

		await expect.poll(() => player.sessions.list().length).toBe(1);
		await expect.poll(() => listensIn(startedBy(player))).toBe(true);
		const strict = await strictOnceSettled(player);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/api/sessions").length,
			1,
		);
		expect(player.sessions.list()).toHaveLength(1);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("this device's own row, while the page listens to what it started", () => {
	test.use(OFFERING_SESSIONS);

	test(`comes after the player's row and before the start row, carries this device's name and "${THIS_DEVICE}", and is the row this tab is in`, async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(rows(page)).toHaveCount(3);
		await expect(rows(page).nth(1)).toContainText(DEVICE_NAME);
		await expect(rows(page).nth(1)).toContainText(THIS_DEVICE);
		await expect(ownRow(page)).toContainText(DEVICE_NAME);
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText(THIS_DEVICE);
		await expect(rows(page).last().getByRole("button")).toHaveAccessibleName(
			START,
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("its face is no button, since this device hears it", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(ownRow(page)).toBeVisible();
		await expect(
			ownRow(page).getByRole("button").filter({ hasText: DEVICE_NAME }),
		).toHaveCount(0);
		await expect(
			ownRow(page).getByRole("button", { name: /listen/i }),
		).toHaveCount(0);
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`its listening line reads "${LISTENING_HERE}" with exactly one way out, Leave, named "${LEAVE_NAMED}"`, async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		await expect(waysOut(ownRow(page))).toHaveCount(1);
		await expect(waysOut(playingOn(page))).toHaveCount(1);
		await expect(waysOut(ownRow(page))).toHaveAccessibleName(LEAVE_NAMED);
		await expect(waysOut(ownRow(page))).toHaveText("Leave");
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`says "${ONLY_LISTENER}" while nobody else listens`, async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(ownRow(page).getByText(ONLY_LISTENER)).toBeVisible();
		await expect(playingOn(page).getByText(ONLY_LISTENER)).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("does not say leaving ends it while another device listens too", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		player.addSessionListener(started.id, ANOTHER_DEVICE);

		await expect(ownRow(page).getByText("Also listening")).toBeVisible();
		await expect(playingOn(page).getByText(ONLY_LISTENER)).toHaveCount(0);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("on a phone, names what it plays once something plays in it", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the desktop's popover leaves the status bar in view, and nothing decides this row's second line there",
		);
		const cast = thePlayerPlays(player);
		const { strict, refused, started } = await inStartedSession(page, player);
		await expect(ownRow(page)).toBeVisible();

		started.play([cast.inTheSession, cast.nextInTheSession], 0);

		await expect(ownRow(page)).toContainText(titleOf(cast.inTheSession));
		await expect(ownRow(page)).toContainText(
			field(cast.inTheSession, "%artist%"),
		);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the player's row while the page is in what it started", () => {
	test.use(OFFERING_SESSIONS);

	test("is still first, offers no Listen here, and is not the row this tab is in; the start row is still last", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(ownRow(page)).toBeVisible();
		await expect(
			rows(page).first().getByText(PLAYER_NAME, { exact: true }),
		).toBeVisible();
		await expect(playingOn(page).getByText("Listen here")).toHaveCount(0);
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).not.toContainText(PLAYER_NAME, {
			useInnerText: true,
		});
		await expect(startButton(page)).toBeVisible();
		await expect(rows(page).last().getByRole("button")).toHaveAccessibleName(
			START,
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("its face is no button", async ({ page, player }) => {
		const { strict, refused } = await inStartedSession(page, player);

		await expect(ownRow(page)).toBeVisible();
		await expect(playerRowOf(page)).toHaveCount(1);
		await expect(
			playerRowOf(page).getByRole("button").filter({ hasText: PLAYER_NAME }),
		).toHaveCount(0);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("its fader moves the player, naming no session, and what the page started stays as it was", async ({
		page,
		player,
		isMobile,
	}) => {
		const cast = thePlayerPlays(player);
		const { strict, refused, started } = await inStartedSession(page, player);
		started.play([cast.inTheSession, cast.nextInTheSession], 0);
		await expect(ownRow(page)).toBeVisible();
		await untilQuiet(player);
		const asItPlayed = {
			track: sessionPlays(started),
			playback: started.playback(),
			position: started.position,
		};
		const volumeBefore = player.player.volume.value;
		const volumesBefore = postsTo(player, "/api/volume").length;

		const fader = playerRowOf(page).getByRole("slider", {
			name: `Volume on ${PLAYER_NAME}`,
		});
		await expect(fader).toBeVisible();
		if (isMobile) {
			const box = (await fader.boundingBox())!;
			await fader.tap({ position: { x: box.width * 0.2, y: box.height / 2 } });
		} else await dragTo(page, fader, 0.2);

		await expect
			.poll(() => postsTo(player, "/api/volume").length)
			.toBeGreaterThan(volumesBefore);
		await untilQuiet(player);
		expect(
			postsTo(player, "/api/volume").map(
				(entry) => scopeIn(entry.path).session,
			),
		).toEqual(postsTo(player, "/api/volume").map(() => null));
		expect(player.player.volume.value).not.toBe(volumeBefore);
		expect({
			track: sessionPlays(started),
			playback: started.playback(),
			position: started.position,
		}).toEqual(asItPlayed);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the opener, as the page starts and leaves", () => {
	test.use(OFFERING_SESSIONS);

	test(`is named "${STARTED_HERE}" while the page is in what it started, and as today on the player`, async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await expect(opener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);

		await startHere(page, player);
		const strict = await strictOnceSettled(player);
		await expect(opener(page)).toHaveAccessibleName(STARTED_HERE);

		strict.release();
		await leaveButton(page).click();
		await expect.poll(() => player.sessions.list()).toEqual([]);
		await expect(opener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
		expect(refused).toEqual([]);
	});
});

test.describe("leaving what this device started", () => {
	test.use(OFFERING_SESSIONS);

	test("Leave lets go of the stream before it asks to leave, and what it started ends", async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);
		const order = browserSaw(page);

		strict.release();
		await leaveButton(page).click();

		await expectSettlesAt(player, () => player.sessions.find(started.id), null);
		expect(order.filter((step) => step !== "stream").slice(0, 2)).toEqual([
			"stream closed",
			"leave",
		]);
		expect(countPostsToSession(player, "/api/stream/leave", started.id)).toBe(
			postsTo(player, "/api/stream/leave").length,
		);
	});

	test("Leave puts the page back on the player without listening: its poll names no session, the tab keeps nothing, and no ticket or stream is taken for the player", async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);
		await untilQuiet(player);
		const opened = streamsOpened(player);

		strict.release();
		await leaveButton(page).click();

		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await expect.poll(() => statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
		await expect.poll(() => storedForThisTab(page)).toBeNull();
		await expectSettlesAt(
			player,
			() => countPostsToSession(player, "/api/stream/ticket", "engine"),
			0,
		);
		expect(streamsOpened(player)).toBe(opened);
	});

	test("after Leave the picker offers the player's face again and the start row, and nothing was sent to the player", async ({
		page,
		player,
	}) => {
		const cast = thePlayerPlays(player);
		await openOnThePlayer(page);
		await expect(statusBar(page)).toContainText(titleOf(cast.atThePlayer));
		await untilQuiet(player);
		const before = heldAtThePlayer(player);
		const started = await startHere(page, player);
		const strict = await strictOnceSettled(player);

		strict.release();
		await leaveButton(page).click();

		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(startButton(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(2);
		await expect(currentRows(page)).toContainText(PLAYER_NAME);
		await expectThePlayerUntouched(player, before);
	});
});

test.describe("a page listening to what it started, loaded again", () => {
	test.use(OFFERING_SESSIONS);

	const STREAM_ROUTES = new Set([
		"POST /api/stream/ticket",
		"GET /api/stream",
		"POST /api/stream/leave",
	]);

	const streamAsks = (player: FakePlayer) =>
		player.requests
			.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`)
			.filter((route) => STREAM_ROUTES.has(route));

	test("names it from its first poll, and sends no ticket, opens no stream and sends no leave", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await untilQuiet(player);
		const asked = streamAsks(player).length;
		const polls = statePollsSentBy(page);

		await page.reload();
		await expect(opener(page)).toBeVisible();
		await expect.poll(() => polls.length).toBeGreaterThan(1);

		expect(polls).toEqual(polls.map(() => inThe(started)));
		await expectSettlesAt(player, () => streamAsks(player).length, asked);
		expect(player.sessions.find(started.id)).toBe(started);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("offers Start playing on its row's listening line, and pressing it takes one ticket naming it and opens the stream", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await page.reload();
		await openPicker(page);
		await untilQuiet(player);
		const tickets = postsTo(player, "/api/stream/ticket").length;

		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		const startPlaying = ownRow(page).getByRole("button", {
			name: "Start playing",
			exact: true,
		});
		await expect(startPlaying).toBeVisible();
		await startPlaying.click();

		await expect.poll(() => listensIn(started)).toBe(true);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/api/stream/ticket").length,
			tickets + 1,
		);
		expect(countPostsToSession(player, "/api/stream/ticket", started.id)).toBe(
			2,
		);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("a second page of the browser that started something", () => {
	test.use(OFFERING_SESSIONS);

	test("opens on the player while the first page stays in what it started", async ({
		page,
		player,
	}) => {
		const firstPagePolls = statePollsSentBy(page);
		const { strict, started } = await inStartedSession(page, player);

		strict.release();
		const second = await page.context().newPage();
		const secondPagePolls = statePollsSentBy(second);
		await second.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(second)).toHaveAccessibleName(ON_THE_PLAYER_NAME);

		expect(await storedForThisTab(second)).toBeNull();
		const firstFrom = firstPagePolls.length;
		await expect.poll(() => secondPagePolls.length).toBeGreaterThan(2);
		await expect.poll(() => firstPagePolls.length).toBeGreaterThan(firstFrom);

		expect(secondPagePolls.filter((poll) => poll.session !== null)).toEqual([]);
		expect(firstPagePolls.slice(firstFrom)).toEqual(
			firstPagePolls.slice(firstFrom).map(() => inThe(started)),
		);
		expect(listensIn(started)).toBe(true);
	});
});

const listeningBeside = async (
	page: Page,
	player: FakePlayer,
	session: DetachedSession,
) => {
	const beside = await page.context().newPage();
	await storeForThisTab(beside, { id: session.id, listening: true });
	const refused = refusalsFrom(beside);
	const polls = statePollsSentBy(beside);
	await beside.goto(ROUTE_WITH_NO_LIST);
	await openPicker(beside);
	await playingOn(beside)
		.getByRole("button", { name: "Start playing", exact: true })
		.click();
	return { beside, refused, polls };
};

test.describe("two pages of one browser listening to what one of them started", () => {
	test.use(OFFERING_SESSIONS);

	test("the first page's Leave ends nothing, leaves the second page's stream and poll on it, and raises no toast saying it ended", async ({
		page,
		player,
	}) => {
		await watchTheToasts(page);
		const cast = castOf(player);
		const { strict, started } = await inStartedSession(page, player);
		started.play([cast.inTheSession, cast.nextInTheSession], 0);
		const { refused, polls } = await listeningBeside(page, player, started);
		await expect.poll(() => connectionsIn(started)).toBe(2);
		await untilQuiet(player);
		const tickets = countPostsToSession(
			player,
			"/api/stream/ticket",
			started.id,
		);
		const asItPlayed = howItPlays(started);

		strict.release();
		await leaveButton(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect
			.poll(() => countPostsToSession(player, "/api/stream/leave", started.id))
			.toBeGreaterThan(0);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		const from = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(from + 1);

		expect(player.sessions.find(started.id)).toBe(started);
		expect(connectionsIn(started)).toBe(1);
		expect(howItPlays(started)).toEqual(asItPlayed);
		expect(countPostsToSession(player, "/api/stream/ticket", started.id)).toBe(
			tickets,
		);
		expect(polls.slice(from)).toEqual(
			polls.slice(from).map(() => inThe(started)),
		);
		expect(
			(await toastsRaised(page)).filter((said) => /ended/i.test(said)),
		).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the second page's Leave, after the first's, ends it", async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);
		const { beside } = await listeningBeside(page, player, started);
		await expect.poll(() => connectionsIn(started)).toBe(2);

		strict.release();
		await leaveButton(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		expect(player.sessions.find(started.id)).toBe(started);

		await leaveButton(beside).click();

		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await expect(thePlayersFace(beside)).toBeVisible();
	});
});

test.describe("two pages of one browser in two sessions", () => {
	test.use(OFFERING_SESSIONS);

	test("a Leave in one leaves the other's session, poll and stream untouched", async ({
		page,
		player,
	}) => {
		const { cast } = setTheScene(player);
		const elsewhere = startedBy(player);
		await openOnThePlayer(page);
		await openPicker(page);
		await startButton(page).click();
		await expect.poll(() => player.sessions.list().length).toBe(2);
		const [started] = player.sessions
			.list()
			.filter((session) => session !== elsewhere);
		await expect.poll(() => listensIn(started)).toBe(true);
		const strict = await strictOnceSettled(player);
		elsewhere.play([cast.nextInTheSession, cast.inTheSession], 0);
		const { beside, refused, polls } = await listeningBeside(
			page,
			player,
			elsewhere,
		);
		await expect.poll(() => listensIn(elsewhere)).toBe(true);
		await untilQuiet(player);
		const tickets = countPostsToSession(
			player,
			"/api/stream/ticket",
			elsewhere.id,
		);
		const asItPlayed = howItPlays(elsewhere);

		strict.release();
		await leaveButton(page).click();
		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		const from = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(from + 1);

		expect(player.sessions.find(elsewhere.id)).toBe(elsewhere);
		expect(connectionsIn(elsewhere)).toBe(1);
		expect(howItPlays(elsewhere)).toEqual(asItPlayed);
		expect(countPostsToSession(player, "/api/stream/leave", elsewhere.id)).toBe(
			0,
		);
		expect(
			countPostsToSession(player, "/api/stream/ticket", elsewhere.id),
		).toBe(tickets);
		expect(polls.slice(from)).toEqual(
			polls.slice(from).map(() => inThe(elsewhere)),
		);
		await expect(statusBar(beside)).toContainText(
			titleOf(cast.nextInTheSession),
		);
		expect(refused).toEqual([]);
	});
});

const ICON_WATCH_MS = 1_200;

const iconsDrawnOver = (page: Page) =>
	page.evaluate(
		(ms) =>
			new Promise<number>((resolve) => {
				const seen = new Set<string>();
				const look = () => {
					const link =
						document.querySelector<HTMLLinkElement>("link[rel='icon']");
					if (link) seen.add(link.href);
				};
				look();
				const timer = setInterval(look, 25);
				setTimeout(() => {
					clearInterval(timer);
					look();
					resolve(seen.size);
				}, ms);
			}),
		ICON_WATCH_MS,
	);

const iconIsDrawn = (page: Page) =>
	expect
		.poll(() =>
			page.evaluate(
				() =>
					document
						.querySelector<HTMLLinkElement>("link[rel='icon']")
						?.href.startsWith("data:") ?? false,
			),
		)
		.toBe(true);

const SESSION_PUBLISHER = "Discos Aparte";
const PLAYER_PUBLISHER = "Discos de la Casa";

test.describe("the tab's icon and the details panel of a tab in a session follow the session", () => {
	test.use(IN_SESSIONS);

	test("the tab's icon turns while the session plays, though the player is paused", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		player.patchPlayer({ playbackState: "paused" });
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await untilQuiet(player);
		await iconIsDrawn(page);

		expect(await iconsDrawnOver(page)).toBeGreaterThan(2);
		expect(refused).toEqual([]);
	});

	test("the tab's icon holds still while the session is paused, though the player plays", async ({
		page,
		player,
	}) => {
		const { cast, session } = setTheScene(player);
		expect(session.playback()).toBe("paused");
		expect(player.player.playbackState).toBe("playing");
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));
		await untilQuiet(player);
		await iconIsDrawn(page);

		expect(await iconsDrawnOver(page)).toBe(1);
		expect(refused).toEqual([]);
	});

	test("the details panel shows the session's track, and never the player's", async ({
		page,
		player,
		isMobile,
	}) => {
		const { cast, session } = setTheScene(player, { heard: true });
		player.retagPlaying({ "%publisher%": PLAYER_PUBLISHER });
		session.play(
			[
				{ ...cast.inTheSession, "%publisher%": SESSION_PUBLISHER },
				cast.nextInTheSession,
			],
			0,
		);
		await watchFor(page, [PLAYER_PUBLISHER]);
		const refused = await openInSession(page, player, session);
		await expect(statusBar(page)).toContainText(titleOf(cast.inTheSession));

		await openNowPlaying(page);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Details").click();
		await expect(panel).toContainText(SESSION_PUBLISHER);

		expect(await everShown(page)).toEqual([]);
		expect(refused).toEqual([]);
	});
});

test.describe("the picker from the keyboard, starting and leaving", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const whereFocusSettles = (page: Page) =>
		expect.poll(() =>
			playingOn(page).evaluate((group) => {
				const focused = document.activeElement;
				if (!focused || focused === document.body) return "body";
				return group.parentElement?.contains(focused)
					? "the picker"
					: "elsewhere";
			}),
		);

	test("Enter on the start row leaves focus on Leave, and Enter on Leave leaves it on the player's face, from where Escape gives it back to the opener", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await opener(page).focus();
		await page.keyboard.press("Enter");
		await expect(thePlayersFace(page)).toBeFocused();

		await startButton(page).focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => player.sessions.list().length).toBe(1);
		await expect(leaveButton(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(leaveButton(page)).toBeFocused();
		const strict = await strictOnceSettled(player);
		await expect(leaveButton(page)).toBeFocused();

		strict.release();
		await page.keyboard.press("Enter");
		await expect(thePlayersFace(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(thePlayersFace(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(opener(page)).toBeFocused();
		expect(refused).toEqual([]);
	});

	test("in what it started, Enter on the opener focuses Leave, Tab goes on to the start row, and Shift+Tab from Leave reaches the player's row", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();

		await opener(page).focus();
		await page.keyboard.press("Enter");
		await expect(leaveButton(page)).toBeFocused();
		const shareSwitch = playingOn(page).getByRole("switch", {
			name: "Let others join",
			exact: true,
		});

		await page.keyboard.press("Tab");
		await expect(shareSwitch).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(startButton(page)).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(shareSwitch).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(leaveButton(page)).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect
			.poll(() =>
				playerRowOf(page).evaluate((row) =>
					row.contains(document.activeElement),
				),
			)
			.toBe(true);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const BUSY = `${PLAYER_NAME} is busy. A place frees up when somebody leaves.`;
const ENDED_OWN = `What you started here has ended, so Jean is back on ${PLAYER_NAME}.`;
const ENDED_UNKNOWN = `What an unknown device started has ended, so Jean is back on ${PLAYER_NAME}.`;
const KITCHEN = "Kitchen iPad";
const ENDED_KITCHEN = `What ${KITCHEN} started has ended, so Jean is back on ${PLAYER_NAME}.`;

const ONE_PLACE_TAKEN = {
	...OFFERING_SESSIONS,
	fooJean: { maxSessions: 1, canCreateSessions: true },
};

const takeTheOnePlace = (player: FakePlayer) =>
	player.sessions.create({ deviceId: ANOTHER_DEVICE.deviceId, name: null });

const startRowItem = (page: Page) =>
	rows(page).filter({
		has: page.getByRole("button", { name: START, exact: true }),
	});

const busyLine = (page: Page) =>
	startRowItem(page).getByText(BUSY, { exact: true });

const pressStart = async (
	page: Page,
	press: () => Promise<void> = () => startButton(page).click(),
) => {
	const answered = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === "/api/sessions",
	);
	await press();
	const response = await answered;
	return { status: response.status(), body: await response.json() };
};

const TOO_MANY = { status: 503, body: { error: "too many sessions" } };
const NOT_AVAILABLE = {
	status: 503,
	body: { error: "sessions are not available" },
};

const expectBusyUnderTheStartRow = async (page: Page) => {
	await expect(busyLine(page)).toBeVisible();
	await expect(playingOn(page).getByText(BUSY)).toHaveCount(1);
	const button = await startButton(page).boundingBox();
	const line = await busyLine(page).boundingBox();
	if (!button || !line) throw new Error("the start row or its line has no box");
	expect(line.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
};

const expectStillOpen = async (page: Page, isMobile: boolean) => {
	await expect(playingOn(page)).toBeVisible();
	if (isMobile)
		await expect(
			page.getByRole("dialog", { name: "Playing on" }),
		).toBeVisible();
};

const sessionsCreatedHere = (player: FakePlayer) =>
	player.sessions
		.list()
		.filter((session) => session.createdBy.deviceId === DEVICE);

test.describe("a create answered too many sessions, from the player", () => {
	test.use(ONE_PLACE_TAKEN);

	test(`says "${BUSY}" under the start row, and the page stays on the player with the picker open`, async ({
		page,
		player,
		isMobile,
	}) => {
		takeTheOnePlace(player);
		const refused = await openOnThePlayer(page);
		await openPicker(page);

		expect(await pressStart(page)).toEqual(TOO_MANY);

		await expectBusyUnderTheStartRow(page);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/api/sessions").length,
			1,
		);
		await expectStillOpen(page, isMobile);
		await expect(rows(page)).toHaveCount(2);
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(currentRows(page)).toContainText(PLAYER_NAME);
		expect(
			statePolls(player).filter(
				(poll) => poll.session !== null || poll.deviceId !== null,
			),
		).toEqual([]);
		expect(await storedForThisTab(page)).toBeNull();
		expect(postsTo(player, "/api/stream/ticket")).toEqual([]);
		expect(streamsOpened(player)).toBe(0);
		expect(sessionsCreatedHere(player)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the line is gone once a later press on the start row starts something", async ({
		page,
		player,
	}) => {
		takeTheOnePlace(player);
		const refused = await openOnThePlayer(page);
		await openPicker(page);
		expect(await pressStart(page)).toEqual(TOO_MANY);
		await expect(busyLine(page)).toBeVisible();
		await untilQuiet(player);
		expect(await busyLine(page).count()).toBe(1);

		player.fooJean.maxSessions = 2;
		await startButton(page).click();
		await expect.poll(() => sessionsCreatedHere(player).length).toBe(1);
		const [started] = sessionsCreatedHere(player);
		await expect.poll(() => listensIn(started)).toBe(true);
		const strict = await strictOnceSettled(player);

		await expect(leaveButton(page)).toBeVisible();
		await expect(playingOn(page).getByText(BUSY)).toHaveCount(0);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("a create answered too many sessions, from inside what the page started", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { maxSessions: 1, canCreateSessions: true },
	});

	test(`says "${BUSY}" under the start row, and the page stays in its session, listening on the same stream`, async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		const tickets = postsTo(player, "/api/stream/ticket").length;
		const streams = streamsOpened(player);

		expect(await pressStart(page)).toEqual(TOO_MANY);

		await expectBusyUnderTheStartRow(page);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/api/sessions").length,
			2,
		);
		await expectStillOpen(page, isMobile);
		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		await expect(leaveButton(page)).toBeVisible();
		expect(statePolls(player).at(-1)).toEqual(inThe(started));
		expect(JSON.parse((await storedForThisTab(page)) ?? "null")).toEqual({
			id: started.id,
			listening: true,
		});
		expect(connectionsIn(started)).toBe(1);
		expect(streamsOpened(player)).toBe(streams);
		expect(postsTo(player, "/api/stream/ticket").length).toBe(tickets);
		expect(postsTo(player, "/api/stream/leave")).toEqual([]);
		expect(player.sessions.list()).toEqual([started]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const holdDiscovery = async (page: Page) => {
	let release!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/capabilities", async (route) => {
		await released;
		await route.continue().catch(() => {});
	});
	return release;
};

test.describe("a create answered sessions are not available", () => {
	test.use(OFFERING_SESSIONS);

	test("removes the start row with the picker open and the page on the player, until discovery answers again", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await untilTheInstallIsKnown(player);
		await openPicker(page);
		await expect(startButton(page)).toBeVisible();
		const release = await holdDiscovery(page);
		player.fooJean.canCreateSessions = false;

		expect(await pressStart(page)).toEqual(NOT_AVAILABLE);
		player.fooJean.canCreateSessions = true;

		await expect(startButton(page)).toHaveCount(0, {
			timeout: PROBE_TIMEOUT_MS / 2,
		});
		await expect(playingOn(page)).toBeVisible();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await expect(playingOn(page).getByText(START_DETAIL)).toHaveCount(0);
		expect(await storedForThisTab(page)).toBeNull();
		expect(statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
		expect(postsTo(player, "/api/stream/ticket")).toEqual([]);
		expect(streamsOpened(player)).toBe(0);

		player.fooJean.configGeneration += 1;
		release();

		await expect(startButton(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(2);
		expect(refused).toEqual([]);
	});
});

test.describe("the start row from the keyboard, refused and then let through", () => {
	test.use(ONE_PLACE_TAKEN);
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	test("Enter refused for want of a place leaves focus on the start row, and Enter once a place is free leaves it on Leave", async ({
		page,
		player,
	}) => {
		takeTheOnePlace(player);
		const refused = await openOnThePlayer(page);
		await opener(page).focus();
		await page.keyboard.press("Enter");
		await expect(thePlayersFace(page)).toBeFocused();
		await startButton(page).focus();

		expect(await pressStart(page, () => page.keyboard.press("Enter"))).toEqual(
			TOO_MANY,
		);
		await untilQuiet(player);
		expect(
			await startButton(page).evaluate(
				(button) => button === document.activeElement,
			),
		).toBe(true);

		player.fooJean.maxSessions = 2;
		await page.keyboard.press("Enter");
		await expect.poll(() => sessionsCreatedHere(player).length).toBe(1);
		await expect(leaveButton(page)).toBeFocused();
		const strict = await strictOnceSettled(player);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("Enter refused inside what the page started leaves focus on the start row when that session later ends", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await startButton(page).focus();
		expect(await pressStart(page, () => page.keyboard.press("Enter"))).toEqual(
			TOO_MANY,
		);
		await untilQuiet(player);
		await expect(startButton(page)).toBeFocused();

		await endedUnderThePage(player, started, strict);
		await expect(thePlayersFace(page)).toBeVisible();
		await untilQuiet(player);

		expect(
			await startButton(page).evaluate(
				(button) => button === document.activeElement,
			),
		).toBe(true);
		expect(refused).toEqual([]);
	});
});

const recordEveryToast = (page: Page) =>
	page.addInitScript(() => {
		const raised: string[] = [];
		const seen = new WeakSet<Element>();
		Object.assign(window, { everyToast: raised });
		new MutationObserver(() => {
			for (const dismiss of document.querySelectorAll(
				'[role="status"] button[aria-label="Dismiss"]',
			)) {
				const toast = dismiss.parentElement;
				if (!toast || seen.has(toast)) continue;
				seen.add(toast);
				raised.push(toast.textContent ?? "");
			}
		}).observe(document, { subtree: true, childList: true });
	});

const endedToastsRaised = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { everyToast: string[] }).everyToast.filter((said) =>
			/has ended, so Jean is back on/.test(said),
		),
	);

const toastSaying = (page: Page, text: string) =>
	toasts(page).locator("xpath=..").filter({ hasText: text });

const closePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile)
		await page
			.getByRole("dialog", { name: "Playing on" })
			.getByRole("button", { name: "Close", exact: true })
			.click();
	else await page.keyboard.press("Escape");
	await expect(playingOn(page)).toBeHidden();
};

const morePolls = async (player: FakePlayer, count: number) => {
	const from = statePolls(player).length;
	await expect
		.poll(() => statePolls(player).length)
		.toBeGreaterThanOrEqual(from + count);
};

const endedUnderThePage = async (
	player: FakePlayer,
	session: DetachedSession,
	strict: { release: () => void },
) => {
	strict.release();
	player.endSession(session.id);
	await expect.poll(() => statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
};

const inAnothersSession = async (
	page: Page,
	player: FakePlayer,
	name: string | null,
) => {
	const session = player.sessions.create({
		deviceId: ANOTHER_DEVICE.deviceId,
		name,
	});
	session.join(DEVICE);
	await storeForThisTab(page, { id: session.id, listening: false });
	const refused = refusalsFrom(page);
	await page.goto(ROUTE_WITH_NO_LIST);
	await expect(opener(page)).toHaveAccessibleName(
		`Playing what ${name ?? "Unknown device"} started`,
	);
	const strict = await strictOnceSettled(player);
	return { session, strict, refused };
};

test.describe("what this device started, ended under the page", () => {
	test.use(OFFERING_SESSIONS);

	test(`with the picker closed, says "${ENDED_OWN}" once, and the page stops listening and follows the player without a ticket, a stream or a leave`, async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);
		const tickets = postsTo(player, "/api/stream/ticket").length;
		const streams = streamsOpened(player);
		const leaves = postsTo(player, "/api/stream/leave").length;

		await endedUnderThePage(player, started, strict);

		await expect(toastSaying(page, ENDED_OWN)).toBeVisible();
		await expect(opener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_OWN]);
		expect(statePolls(player).slice(-2)).toEqual([
			ON_THE_PLAYER,
			ON_THE_PLAYER,
		]);
		expect(postsTo(player, "/api/stream/ticket").length).toBe(tickets);
		expect(streamsOpened(player)).toBe(streams);
		expect(postsTo(player, "/api/stream/leave").length).toBe(leaves);
		expect(await storedForThisTab(page)).toBeNull();
		expect(refused).toEqual([]);
	});

	test(`with the picker open, says "${ENDED_OWN}" once, and the picker shows the player's row as current, offering Listen here`, async ({
		page,
		player,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await expect(ownRow(page)).toBeVisible();

		await endedUnderThePage(player, started, strict);

		await expect(toastSaying(page, ENDED_OWN)).toBeVisible();
		await expect(playingOn(page)).toBeVisible();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText(PLAYER_NAME);
		await expect(ownRow(page)).toHaveCount(0);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_OWN]);
		expect(refused).toEqual([]);
	});

	test("says it once: not again over later polls, a picker opened and closed, or a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);

		await endedUnderThePage(player, started, strict);
		await expect(toastSaying(page, ENDED_OWN)).toBeVisible();

		await morePolls(player, 3);
		await openPicker(page);
		await expect(thePlayersFace(page)).toBeVisible();
		await closePicker(page, isMobile);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_OWN]);

		await page.reload();
		await expect(opener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("is said in neither the error tone nor the plain toast's", async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);

		await endedUnderThePage(player, started, strict);

		const toast = toastSaying(page, ENDED_OWN);
		await expect(toast).toBeVisible();
		const glyphs = toast.locator("svg");
		const drawnGlyphs = await glyphs.evaluateAll((svgs) =>
			svgs.map((svg) => svg.getAttribute("class") ?? ""),
		);
		expect(
			drawnGlyphs.filter((names) => drawing("triangle-alert").test(names)),
		).toEqual([]);
		expect(drawnGlyphs.filter((names) => drawing("check").test(names))).toEqual(
			[],
		);
		const danger = await tokenColourIn(toast, "--danger");
		const colours = await glyphs.evaluateAll((svgs) =>
			svgs.map((svg) => getComputedStyle(svg).stroke),
		);
		expect(colours).not.toContain(danger);
	});
});

test.describe("what another device started, ended under the page", () => {
	test.use(OFFERING_SESSIONS);

	test(`says "${ENDED_KITCHEN}" once, naming the device that started it`, async ({
		page,
		player,
	}) => {
		await recordEveryToast(page);
		const { session, strict, refused } = await inAnothersSession(
			page,
			player,
			KITCHEN,
		);

		await endedUnderThePage(player, session, strict);

		await expect(toastSaying(page, ENDED_KITCHEN)).toBeVisible();
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_KITCHEN]);
		expect(refused).toEqual([]);
	});

	test(`says "${ENDED_UNKNOWN}" once where the device that started it has no name`, async ({
		page,
		player,
	}) => {
		await recordEveryToast(page);
		const { session, strict, refused } = await inAnothersSession(
			page,
			player,
			null,
		);

		await endedUnderThePage(player, session, strict);

		await expect(toastSaying(page, ENDED_UNKNOWN)).toBeVisible();
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_UNKNOWN]);
		expect(refused).toEqual([]);
	});
});

test.describe("a page loaded into a stored session the player no longer holds", () => {
	test.use(OFFERING_SESSIONS);

	test(`says "${ENDED_UNKNOWN}" once`, async ({ page, player }) => {
		await recordEveryToast(page);
		await storeForThisTab(page, { id: "no-longer-held", listening: false });
		await page.goto(ROUTE_WITH_NO_LIST);

		await expect.poll(() => storedForThisTab(page)).toBeNull();
		await expect(toastSaying(page, ENDED_UNKNOWN)).toBeVisible();
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await endedToastsRaised(page)).toEqual([ENDED_UNKNOWN]);
	});
});

test.describe("the output cog on the player's row", () => {
	test.use(OFFERING_SESSIONS);

	test("is drawn while this device listens to the player", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await untilTheInstallIsKnown(player);
		await openPicker(page);
		await thePlayersFace(page).click();

		await expect(
			playerRowOf(page).getByRole("button", {
				name: "Output options",
				exact: true,
			}),
		).toBeVisible();
		expect(refused).toEqual([]);
	});

	test("is not drawn while this device listens to what it started", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		await expect(playerRowOf(page)).toHaveCount(1);
		await untilQuiet(player);

		expect(
			await playingOn(page)
				.getByRole("button", {
					name: "Output options",
					exact: true,
					includeHidden: true,
				})
				.count(),
		).toBe(0);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const skipped = (track: string) =>
	`Could not play “${track}”, so it was skipped.`;

const WITHOUT_EFFECTS =
	/^Playing without foobar2000['’]s effects, because one of them failed\.$/;
const WITHOUT_EFFECTS_OPENING = "Playing without foobar2000";

const REPORTED_FIRST = "The Future";
const REPORTED_SECOND = "Deep, Deep";

// Tracks foobar2000 played from outside its media library, so `foo_jean` reports them with a `path`
// and no `libraryPath`.
const OFF_THE_LIBRARY: Track = {
	"%path%": "C:\\Elsewhere\\Dragged in\\07. Not In The Library.flac",
	"%subsong%": "0",
};
const WITH_NO_DIRECTORY: Track = {
	"%path%": "Loose Track.flac",
	"%subsong%": "0",
};
const SKIPPED_OFF_THE_LIBRARY =
	/^Could not play “07\. Not In The Library(\.flac)?”, so it was skipped\.$/;
const SKIPPED_WITH_NO_DIRECTORY =
	/^Could not play “Loose Track(\.flac)?”, so it was skipped\.$/;

const libraryTrackTitled = (player: FakePlayer, title: string) => {
	const track = player
		.playlistById("p7")
		?.items.find((held) => titleOf(held) === title);
	if (!track || player.libraryPathFor(track) === null)
		throw new Error(`the library holds no "${title}"`);
	return track;
};

const skippedToastsRaised = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { everyToast: string[] }).everyToast.filter((said) =>
			said.includes("skipped"),
		),
	);

const documentReads = (player: FakePlayer, session: DetachedSession) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === `/api/sessions/${session.id}`,
	).length;

const moreDocumentReads = async (
	player: FakePlayer,
	session: DetachedSession,
	count: number,
) => {
	const from = documentReads(player, session);
	await expect
		.poll(() => documentReads(player, session))
		.toBeGreaterThanOrEqual(from + count);
};

const expectErrorTone = async (toast: Locator) => {
	const danger = await tokenColourIn(toast, "--danger");
	await expect
		.poll(() =>
			toast
				.locator("svg")
				.evaluateAll((svgs) =>
					svgs.map((svg) => [
						svg.getAttribute("class") ?? "",
						getComputedStyle(svg).stroke,
					]),
				),
		)
		.toContainEqual([expect.stringMatching(drawing("triangle-alert")), danger]);
};

test.describe("a track the session this page listens to could not play", () => {
	test.use(OFFERING_SESSIONS);

	test(`with the picker closed, raises one toast "${skipped("{title}")}" in the error tone, naming the track by the title the library holds for its path`, async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		const toast = toastSaying(page, skipped(REPORTED_SECOND));
		await expect(toast).toBeVisible();
		await expectErrorTone(toast);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("names a track the library does not hold by its file's name, whether its path has directories or none", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);

		player.addSessionReport(started.id, OFF_THE_LIBRARY);
		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(1);
		player.addSessionReport(started.id, WITH_NO_DIRECTORY);
		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(2);

		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([
			expect.stringMatching(SKIPPED_OFF_THE_LIBRARY),
			expect.stringMatching(SKIPPED_WITH_NO_DIRECTORY),
		]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("two reports read together raise two toasts, one each, in the order they were reported", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);
		const reads = documentReads(player, started);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_FIRST),
		);
		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(2);
		await untilQuiet(player);
		expect(documentReads(player, started)).toBe(reads + 1);
		expect(await skippedToastsRaised(page)).toEqual([
			skipped(REPORTED_FIRST),
			skipped(REPORTED_SECOND),
		]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("raises it once: not again on later reads of the document, nor after a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);
		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();

		started.share(true);
		await moreDocumentReads(player, started, 1);
		started.share(false);
		await moreDocumentReads(player, started, 1);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);

		const reads = documentReads(player, started);
		await page.reload();
		await expect(opener(page)).toHaveAccessibleName(STARTED_HERE);
		await expect
			.poll(() => documentReads(player, started))
			.toBeGreaterThan(reads);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(started.reports).toHaveLength(1);
		expect(await skippedToastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("with the picker open, raises the toast and leaves the picker open", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);
		await expectStillOpen(page, isMobile);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("reports already in a session's document when the page enters it", () => {
	test.use(OFFERING_SESSIONS);

	test("raise nothing, and a report made after the page entered raises one", async ({
		page,
		player,
	}) => {
		await recordEveryToast(page);
		const session = player.sessions.create({
			deviceId: ANOTHER_DEVICE.deviceId,
			name: KITCHEN,
		});
		session.join(DEVICE);
		player.addSessionReport(
			session.id,
			libraryTrackTitled(player, REPORTED_FIRST),
		);
		player.addSessionReport(session.id, OFF_THE_LIBRARY);
		await storeForThisTab(page, { id: session.id, listening: true });
		const refused = refusalsFrom(page);

		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(
			`Playing what ${KITCHEN} started`,
		);
		const strict = await strictOnceSettled(player);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([]);

		player.addSessionReport(
			session.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("two pages of one browser showing one session", () => {
	test.use(OFFERING_SESSIONS);

	test("each raise a report once", async ({ page, player }) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		const beside = await page.context().newPage();
		await recordEveryToast(beside);
		await storeForThisTab(beside, { id: started.id, listening: true });
		const refusedBeside = refusalsFrom(beside);
		await beside.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(beside)).toHaveAccessibleName(STARTED_HERE);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await expect(toastSaying(beside, skipped(REPORTED_SECOND))).toBeVisible();
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		expect(await skippedToastsRaised(beside)).toEqual([
			skipped(REPORTED_SECOND),
		]);
		strict.release();
		expect(refused).toEqual([]);
		expect(refusedBeside).toEqual([]);
	});
});

const chainDroppedUnder = async (
	player: FakePlayer,
	session: DetachedSession,
) => {
	const cast = castOf(player);
	session.play([cast.inTheSession, cast.nextInTheSession], 0);
	await untilQuiet(player);
	player.dropSessionChain(session.id);
	await moreDocumentReads(player, session, 1);
};

test.describe("while the session's document reads chainDropped", () => {
	test.use(OFFERING_SESSIONS);

	test("the row this tab is in says the session plays without foobar2000's effects, once and in no other row, and no toast says a track was skipped", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);

		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		await expect(currentRows(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		await expect(playerRowOf(page).getByText(WITHOUT_EFFECTS)).toHaveCount(0);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the line still stands after a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);
		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();

		await page.reload();
		await openPicker(page);

		await expect(currentRows(page).getByText(WITHOUT_EFFECTS)).toBeVisible();
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the line is never drawn while the document reads chainDropped false, though it holds a report", async ({
		page,
		player,
	}) => {
		await watchFor(page, [WITHOUT_EFFECTS_OPENING]);
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);

		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		expect(await everShown(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the without-effects line, once the page is back on the player", () => {
	test.use(OFFERING_SESSIONS);

	test("is gone from every row once the page leaves a session whose chain dropped", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);
		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();

		strict.release();
		await leaveButton(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect.poll(() => statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
		await untilQuiet(player);

		expect(await playingOn(page).getByText(WITHOUT_EFFECTS).count()).toBe(0);
		expect(refused).toEqual([]);
	});
});
