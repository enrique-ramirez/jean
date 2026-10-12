// ---- a page in a session ----------------------------------------------------
import type { DetachedSession } from "../fake-api/sessions.ts";
import type { Track } from "../fake-api/state.ts";
import {
	expect,
	expectSettlesAt,
	type FakePlayer,
	fieldOf,
	type Locator,
	type Page,
	pickerOpener,
	playingOn,
	REFUSED_ROUTES,
	titleOf,
	toasts,
	untilQuiet,
} from "./fixtures.ts";

export const DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";
export const DEVICE_NAME = "Den laptop";

// An install that offers sessions, and a browser whose device id is known before the page loads.
export const OFFERING_SESSIONS = {
	fooJean: { maxSessions: 4, canCreateSessions: true },
	settings: { "jean.deviceId": DEVICE, "jean.deviceName": DEVICE_NAME },
};

export const SESSION_KEY = "jean.session";

// Search before anything is searched for draws no list of tracks, so a title on screen there is one
// a playing surface drew.
export const ROUTE_WITH_NO_LIST = "/#/search";

export const PLAYER_NAME = "foobar2000";
export const START = "Play something else here";
export const THIS_DEVICE = "This device";
export const LEAVE_NAMED = `Leave, and go back to ${PLAYER_NAME}`;

export const openPicker = async (page: Page) => {
	await pickerOpener(page).click();
	await expect(playingOn(page)).toBeVisible();
};

export const pickerRows = (page: Page) =>
	playingOn(page).getByRole("listitem").and(page.locator("li:not(li li)"));

// Exact: Playwright's `hasText` ignores case, and the player's drift line reads "Runs ahead of this device".
export const rowLabelled = (page: Page, label: string) =>
	pickerRows(page).filter({ has: page.getByText(label, { exact: true }) });

export const playerRowOf = (page: Page) => rowLabelled(page, PLAYER_NAME);

export const ownRow = (page: Page) => rowLabelled(page, THIS_DEVICE);

// WAI-ARIA reads `aria-current="false"` as not current, the same as no attribute.
export const currentRows = (page: Page) =>
	pickerRows(page).and(
		page.locator('[aria-current]:not([aria-current="false"])'),
	);

export const startButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: START, exact: true });

export const leaveButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: LEAVE_NAMED, exact: true });

// The player's face is a button only while pressing it would listen here.
export const thePlayersFace = (page: Page) =>
	playingOn(page).getByRole("button", { name: "Listen here", exact: true });

export const listensIn = (session: DetachedSession) =>
	session.roster().some((device) => device.deviceId === DEVICE);

// Strict mode answers `500` to any session-scoped request naming no session, so a page in a session
// that sends one is caught here whatever it was for.
export const refusalsFrom = (page: Page) => {
	const refused: string[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (response.status() === 500 && url.pathname.startsWith("/api/"))
			refused.push(`${response.request().method()} ${url.pathname}`);
	});
	return refused;
};

export const strictOnceSettled = async (player: FakePlayer) => {
	await untilQuiet(player);
	player.fooJean.strictSessions = true;
	return {
		release() {
			player.fooJean.strictSessions = false;
		},
	};
};

export const openOnThePlayer = async (
	page: Page,
	route = ROUTE_WITH_NO_LIST,
) => {
	const refused = refusalsFrom(page);
	await page.goto(route);
	await expect(pickerOpener(page)).toBeVisible();
	return refused;
};

export const PAST_THE_SECOND_LEAVE_MS = 3_000;

export const ANOTHER_DEVICE = {
	deviceId: "0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a",
	name: null,
};

export const LYRIC_TAG = "$meta(unsynced lyrics)";
export const SESSION_LYRIC = "Every word here belongs to the session's track";
export const PLAYER_LYRIC = "Every word here belongs to the player's track";

// One track off each record the library holds, so no two roles below share a title, a length or a
// cover, and no surface can agree with the session by drawing the player's.
export const castOf = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const records = new Map<string, Track>();
	for (const track of library) {
		const record = fieldOf(track, "%album%");
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

export type Cast = ReturnType<typeof castOf>;

export interface Scene {
	cast: Cast;
	session: DetachedSession;
}

// The player plays one record and the session another, each with a queue of its own. A session
// nobody hears reads `paused`, so `heard` puts another device's connection on it. `sessionLyric`
// tags the session's track alone.
export const setTheScene = (
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
export const storeForThisTab = (page: Page, value: unknown) =>
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

export const storedForThisTab = (page: Page) =>
	page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);

// Every piece of text the page ever put in front of a person, the tab's title included, checked for
// the watched strings at each change rather than once at the end.
export const watchFor = (page: Page, watched: string[]) =>
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

export const everShown = (page: Page) =>
	page.evaluate(() => [
		...(window as unknown as { textShown: Set<string> }).textShown,
	]);

export interface Scope {
	session: string | null;
	deviceId: string | null;
}

export const scopeIn = (path: string): Scope => {
	const query = new URL(path, "http://fake").searchParams;
	return { session: query.get("session"), deviceId: query.get("deviceId") };
};

export const statePolls = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.split("?")[0] === "/api/state",
		)
		.map((entry) => scopeIn(entry.path));

// Read off the page's own requests, for a case with two pages on one fake.
export const statePollsSentBy = (page: Page) => {
	const sent: Scope[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (request.method() === "GET" && url.pathname === "/api/state")
			sent.push(scopeIn(url.pathname + url.search));
	});
	return sent;
};

export const inThe = (session: DetachedSession): Scope => ({
	session: session.id,
	deviceId: DEVICE,
});

export const ON_THE_PLAYER: Scope = { session: null, deviceId: null };

export const button = (scope: Locator, name: RegExp) =>
	scope.getByRole("button", { name });

export const slider = (scope: Locator, name: RegExp) =>
	scope.getByRole("slider", { name });

// Every command a player with `controlPlayback` off refuses, as `METHOD /path`, sent naming that
// session, or naming none where `session` is null: `contract/openapi.yaml` reads no session as the
// player's own.
export const commandsNaming = (player: FakePlayer, session: string | null) =>
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

// What the player itself is doing: none of it may move while the tab drives its session.
export const heldAtThePlayer = (player: FakePlayer) => ({
	item: { ...player.player.activeItem },
	playback: player.player.playbackState,
	queued: player.queuedEntries().map((entry) => titleOf(entry.track)),
});

export const expectThePlayerUntouched = async (
	player: FakePlayer,
	before: ReturnType<typeof heldAtThePlayer>,
) => {
	await expectSettlesAt(player, () => commandsNaming(player, null), []);
	expect(heldAtThePlayer(player)).toEqual(before);
};

export const sessionPlays = (session: DetachedSession) => {
	const track = session.playingTrack();
	return track ? titleOf(track) : null;
};

export const queuedInTheSession = (session: DetachedSession) =>
	session.queuedEntries().map((entry) => titleOf(entry.track));

// Every toast the page ever raised, by what it said, however soon it went.
export const watchTheToasts = (page: Page) =>
	page.addInitScript(() => {
		const raised = new Set<string>();
		Object.assign(window, { toastsRaised: raised });
		const look = () => {
			for (const dismiss of document.querySelectorAll(
				'[data-toasts] button[aria-label="Dismiss"]',
			))
				raised.add(dismiss.parentElement?.textContent ?? "");
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	});

export const toastsRaised = (page: Page) =>
	page.evaluate(() =>
		[
			...(window as unknown as { toastsRaised: Set<string> }).toastsRaised,
		].sort(),
	);

export const LISTENING_HERE = "Listening here";

export const STARTED_HERE = `Playing what ${DEVICE_NAME} started`;

export const startedBy = (player: FakePlayer) => {
	const [started, ...more] = player.sessions.list();
	if (!started || more.length > 0)
		throw new Error(`the fake holds ${player.sessions.list().length} sessions`);
	return started;
};

export const startHere = async (page: Page, player: FakePlayer) => {
	await openPicker(page);
	await expect(startButton(page)).toBeVisible();
	await startButton(page).click();
	await expect.poll(() => player.sessions.list().length).toBe(1);
	const started = startedBy(player);
	await expect.poll(() => listensIn(started)).toBe(true);
	return started;
};

export const inStartedSession = async (page: Page, player: FakePlayer) => {
	const refused = await openOnThePlayer(page);
	const started = await startHere(page, player);
	const strict = await strictOnceSettled(player);
	return { strict, refused, started };
};

export const KITCHEN = "Kitchen iPad";

export const expectStillOpen = async (page: Page, isMobile: boolean) => {
	await expect(playingOn(page)).toBeVisible();
	if (isMobile)
		await expect(
			page.getByRole("dialog", { name: "Playing on" }),
		).toBeVisible();
};

export const recordEveryToast = (page: Page) =>
	page.addInitScript(() => {
		const raised: string[] = [];
		const seen = new WeakSet<Element>();
		Object.assign(window, { everyToast: raised });
		new MutationObserver(() => {
			for (const dismiss of document.querySelectorAll(
				'[data-toasts] button[aria-label="Dismiss"]',
			)) {
				const toast = dismiss.parentElement;
				if (!toast || seen.has(toast)) continue;
				seen.add(toast);
				raised.push(toast.textContent ?? "");
			}
		}).observe(document, { subtree: true, childList: true });
	});

export const toastSaying = (page: Page, text: string) =>
	toasts(page).locator("xpath=..").filter({ hasText: text });

export const closePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile)
		await page
			.getByRole("dialog", { name: "Playing on" })
			.getByRole("button", { name: "Close", exact: true })
			.click();
	else await page.keyboard.press("Escape");
	await expect(playingOn(page)).toBeHidden();
};

export const morePolls = async (player: FakePlayer, count: number) => {
	const from = statePolls(player).length;
	await expect
		.poll(() => statePolls(player).length)
		.toBeGreaterThanOrEqual(from + count);
};

export const skipped = (track: string) =>
	`Could not play “${track}”, so it was skipped.`;
