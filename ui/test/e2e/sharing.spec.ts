import type { Route } from "@playwright/test";
import { en } from "../../src/shared/i18n/en.ts";
import type { DetachedSession, SessionDevice } from "../fake-api/sessions.ts";
import { evaluate, type Track } from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	countPostsTo,
	countPostsToSession,
	dragTo,
	drawing,
	expect,
	expectDisabledWithReason,
	expectSettlesAt,
	openLibrary,
	playbackCommands,
	playingOn,
	playRequests,
	restingBox,
	statusBar,
	test,
	tokenColourIn,
	touchDrag,
	trackRow,
	untilQuiet,
	untilTheInstallIsKnown,
} from "./fixtures.ts";

const DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";
const DEVICE_NAME = "Den laptop";

const OFFERING_SESSIONS = {
	fooJean: { maxSessions: 4, canCreateSessions: true },
	settings: { "jean.deviceId": DEVICE, "jean.deviceName": DEVICE_NAME },
};

const PLAYER_NAME = "foobar2000";
const START = "Play something else here";
const THIS_DEVICE = "This device";
const UNKNOWN_DEVICE = "Unknown device";
const NOBODY_LISTENING = "Nobody listening";
const LEAVE_NAMED = `Leave, and go back to ${PLAYER_NAME}`;

const ROUTE_WITH_NO_LIST = "/#/search";

const field = (track: Track, expression: string) =>
	String(evaluate(track, expression) ?? "");

const titleOf = (track: Track) => field(track, "%title%");
const artistOf = (track: Track) => field(track, "%artist%");

const oneOffEachRecord = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const records = new Map<string, Track>();
	for (const track of library) {
		const record = field(track, "%album%");
		if (!records.has(record)) records.set(record, track);
	}
	const [atThePlayer, first, second, third] = records.values();
	if (!third) throw new Error("the library holds fewer than four records");
	return {
		atThePlayer,
		elsewhere: [first, second, third],
		rowOf: (track: Track) => library.indexOf(track),
	};
};

let minted = 0;

const aDevice = (name: string | null): SessionDevice => {
	minted += 1;
	return { deviceId: `other-device-${minted}`, name };
};

const startedElsewhere = (
	player: FakePlayer,
	by: string | null | SessionDevice,
	{
		shared = true,
		plays,
		listeners = [],
	}: { shared?: boolean; plays?: Track; listeners?: SessionDevice[] } = {},
): DetachedSession => {
	const creator = by !== null && typeof by === "object" ? by : aDevice(by);
	const session = player.sessions.create(creator);
	if (shared) session.share(true);
	if (plays) session.play([plays], 0);
	for (const device of listeners) player.addSessionListener(session.id, device);
	return session;
};

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

const rowLabelled = (page: Page, label: string) =>
	rows(page).filter({ has: page.getByText(label, { exact: true }) });

const playerRowOf = (page: Page) => rowLabelled(page, PLAYER_NAME);

const ownRow = (page: Page) => rowLabelled(page, THIS_DEVICE);

const startButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: START, exact: true });

const leaveButton = (page: Page) =>
	playingOn(page).getByRole("button", { name: LEAVE_NAMED, exact: true });

const thePlayersFace = (page: Page) =>
	playingOn(page).getByRole("button", { name: "Listen here", exact: true });

// WAI-ARIA reads `aria-current="false"` as not current, the same as no attribute.
const currentRows = (page: Page) =>
	rows(page).and(page.locator('[aria-current]:not([aria-current="false"])'));

const rowsHolding = async (page: Page, labels: string[]) => {
	const holds = async (row: Locator, label: string) =>
		(await row.getByText(label, { exact: true }).count()) > 0 ||
		(await row.getByRole("button", { name: label, exact: true }).count()) > 0;
	const drawn: string[] = [];
	for (const row of await rows(page).all()) {
		const held: string[] = [];
		for (const label of labels) if (await holds(row, label)) held.push(label);
		drawn.push(held.join(" + ") || "?");
	}
	return drawn;
};

const expectRowsInOrder = (page: Page, labels: string[]) =>
	expect.poll(() => rowsHolding(page, labels)).toEqual(labels);

const sessionReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" && entry.path.split("?")[0] === "/api/sessions",
	);

const refusalsFrom = (page: Page) => {
	const refused: string[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (response.status() === 500 && url.pathname.startsWith("/api/"))
			refused.push(`${response.request().method()} ${url.pathname}`);
	});
	return refused;
};

const strictOnceSettled = async (player: FakePlayer) => {
	await untilQuiet(player);
	player.fooJean.strictSessions = true;
	return {
		release() {
			player.fooJean.strictSessions = false;
		},
	};
};

const openOnThePlayer = async (page: Page, route = ROUTE_WITH_NO_LIST) => {
	const refused = refusalsFrom(page);
	await page.goto(route);
	await expect(opener(page)).toBeVisible();
	return refused;
};

const listensIn = (session: DetachedSession) =>
	session.roster().some((device) => device.deviceId === DEVICE);

const startedHere = (player: FakePlayer) =>
	player.sessions
		.list()
		.find((session) => session.createdBy.deviceId === DEVICE) ?? null;

const startHere = async (page: Page, player: FakePlayer) => {
	await openPicker(page);
	await startButton(page).click();
	await expect.poll(() => startedHere(player)).not.toBeNull();
	const started = startedHere(player) as DetachedSession;
	await expect.poll(() => listensIn(started)).toBe(true);
	await expect(leaveButton(page)).toBeVisible();
	return started;
};

const inStartedSession = async (
	page: Page,
	player: FakePlayer,
	route = ROUTE_WITH_NO_LIST,
) => {
	const refused = await openOnThePlayer(page, route);
	const started = await startHere(page, player);
	const strict = await strictOnceSettled(player);
	return { strict, refused, started };
};

const OPEN_CADENCE_MS = 4_000;
const CLOCK_STEP_MS = 250;

const advance = async (page: Page, ms: number) => {
	for (let passed = 0; passed < ms; passed += CLOCK_STEP_MS)
		await page.clock.runFor(CLOCK_STEP_MS);
};

const pauseTheClock = async (page: Page) =>
	page.clock.pauseAt((await page.evaluate(() => Date.now())) + CLOCK_STEP_MS);

test.describe("the picker's list, where sessions are offered", () => {
	test.use(OFFERING_SESSIONS);

	const LISTED = ["Study desk", "Attic radio", "Kitchen tablet"];
	const PRIVATE_ELSEWHERE = "Hall speaker";

	test("lists the player's row, then each session the player lists for this device in the order it lists them, then the start row, and nothing else", async ({
		page,
		player,
	}) => {
		startedElsewhere(player, LISTED[0]);
		startedElsewhere(player, LISTED[1]);
		startedElsewhere(player, PRIVATE_ELSEWHERE, { shared: false });
		startedElsewhere(player, LISTED[2]);
		await openOnThePlayer(page);

		await openPicker(page);

		await expectRowsInOrder(page, [PLAYER_NAME, ...LISTED, START]);
		await expect(rows(page)).toHaveCount(5);
		await expect(playingOn(page).getByText(PRIVATE_ELSEWHERE)).toHaveCount(0);
	});

	test("is read when the picker opens, again at the open cadence while it stays open, and never while it is closed", async ({
		page,
		player,
	}) => {
		const leaving = startedElsewhere(player, "Study desk");
		await page.clock.install();
		await openOnThePlayer(page);
		await untilQuiet(player);
		await pauseTheClock(page);

		const closedFrom = sessionReads(player).length;
		await advance(page, 3 * OPEN_CADENCE_MS);
		await untilQuiet(player);
		expect(sessionReads(player).length).toBe(closedFrom);

		await opener(page).click();
		await advance(page, CLOCK_STEP_MS);
		await expect.poll(() => sessionReads(player).length).toBe(closedFrom + 1);
		await expect(rowLabelled(page, "Study desk")).toHaveCount(1);

		startedElsewhere(player, "Attic radio");
		await advanceSettled(page, player, OPEN_CADENCE_MS);
		await expect(rowLabelled(page, "Attic radio")).toHaveCount(1);

		player.endSession(leaving.id);
		await advanceSettled(page, player, OPEN_CADENCE_MS);
		await expect(rowLabelled(page, "Study desk")).toHaveCount(0);
		await expect(rowLabelled(page, "Attic radio")).toHaveCount(1);
		await expect(playingOn(page)).toBeVisible();

		await untilQuiet(player);
		const openReads = sessionReads(player).length - closedFrom;
		expect(openReads).toBeGreaterThanOrEqual(3);
		expect(openReads).toBeLessThanOrEqual(4);
		expect(
			sessionReads(player).map((entry) =>
				new URL(entry.path, "http://fake").searchParams.get("deviceId"),
			),
		).toEqual(sessionReads(player).map(() => DEVICE));
	});

	test("draws a slider in the player's row alone, with sessions listed", async ({
		page,
		player,
	}) => {
		startedElsewhere(player, "Study desk");
		startedElsewhere(player, "Attic radio");
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rowLabelled(page, "Attic radio")).toHaveCount(1);

		await expect(playingOn(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRowOf(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRowOf(page).getByRole("slider")).toHaveAccessibleName(
			`Volume on ${PLAYER_NAME}`,
		);
	});

	test("marks the player's row current on the player, with sessions listed", async ({
		page,
		player,
	}) => {
		startedElsewhere(player, "Study desk");
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rowLabelled(page, "Study desk")).toHaveCount(1);

		await expect(currentRows(page)).toHaveCount(1);
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
	});

	test("marks the row of what the page started current once it is in it, and no other, with sessions listed", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		startedElsewhere(player, "Study desk");
		await page.keyboard.press("Escape");
		await openPicker(page);
		await expect(rowLabelled(page, "Study desk")).toHaveCount(1);

		await expect(rows(page)).toHaveCount(4);
		await expect(currentRows(page)).toHaveCount(1);
		await expect(
			currentRows(page).getByText(THIS_DEVICE, { exact: true }),
		).toHaveCount(1);
		await expect(
			currentRows(page).getByText(DEVICE_NAME, { exact: true }),
		).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("a listed session's label", () => {
	test.use(OFFERING_SESSIONS);

	test("tells two devices with one name apart", async ({ page, player }) => {
		startedElsewhere(player, "iPhone");
		startedElsewhere(player, "iPhone");
		await openOnThePlayer(page);
		await openPicker(page);

		await expectRowsInOrder(page, [PLAYER_NAME, "iPhone", "iPhone (2)", START]);
	});

	test(`reads "${UNKNOWN_DEVICE}" for a device that gave no name`, async ({
		page,
		player,
	}) => {
		startedElsewhere(player, null);
		await openOnThePlayer(page);
		await openPicker(page);

		await expect(rows(page)).toHaveCount(3);
		await expect(rows(page).nth(1)).toContainText(UNKNOWN_DEVICE);
		await expect(rowLabelled(page, UNKNOWN_DEVICE)).toHaveCount(1);
	});

	test(`a second page of this browser, on the player, lists what the first page started as this device's, by its name and "${THIS_DEVICE}", though it is private`, async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);
		expect(started.shared).toBe(false);
		strict.release();

		const second = await page.context().newPage();
		await openOnThePlayer(second);
		await openPicker(second);

		await expect(rows(second)).toHaveCount(3);
		await expect(ownRow(second)).toHaveCount(1);
		await expect(
			ownRow(second).getByText(DEVICE_NAME, { exact: true }),
		).toHaveCount(1);
		await expect(rows(second).nth(1)).toContainText(THIS_DEVICE);
		await expect(currentRows(second)).toHaveCount(1);
		await expect(
			currentRows(second).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
	});

	test("stays its creator's after the creator has left, while another device keeps it", async ({
		page,
		player,
	}) => {
		const creator = aDevice("Study desk");
		const keeper = aDevice("Porch tablet");
		const session = startedElsewhere(player, creator, { listeners: [keeper] });
		player.sessions.leave(session, creator.deviceId);
		expect(player.sessions.find(session.id)).toBe(session);
		await openOnThePlayer(page);

		await openPicker(page);

		await expect(rows(page)).toHaveCount(3);
		await expect(rowLabelled(page, "Study desk")).toHaveCount(1);
		await expect(playingOn(page).getByText("Porch tablet")).toHaveCount(0);
	});
});

test.describe("two sessions this device started, from two pages of one browser", () => {
	test.use(OFFERING_SESSIONS);

	test(`are told apart in a third page's picker, in listed order: "${DEVICE_NAME}", then "${DEVICE_NAME} (2)", each reading "${THIS_DEVICE}"`, async ({
		page,
		player,
	}) => {
		await openOnThePlayer(page);
		await startHere(page, player);
		const second = await page.context().newPage();
		await openOnThePlayer(second);
		await openPicker(second);
		await startButton(second).click();
		await expect.poll(() => player.sessions.list().length).toBe(2);
		await expect(leaveButton(second)).toBeVisible();

		const third = await page.context().newPage();
		const refused = await openOnThePlayer(third);
		await openPicker(third);

		await expect
			.poll(() =>
				rowsHolding(third, [
					PLAYER_NAME,
					DEVICE_NAME,
					`${DEVICE_NAME} (2)`,
					THIS_DEVICE,
					START,
				]),
			)
			.toEqual([
				PLAYER_NAME,
				`${DEVICE_NAME} + ${THIS_DEVICE}`,
				`${DEVICE_NAME} (2) + ${THIS_DEVICE}`,
				START,
			]);
		expect(refused).toEqual([]);
	});
});

test.describe("a row this tab is not in", () => {
	test.use(OFFERING_SESSIONS);

	const LISTENERS = ["Garage radio", "Porch tablet"];

	test(`shows what it plays and how many listen, "2 listening", "1 listening" or "${NOBODY_LISTENING}", and neither who listens nor whether it plays or is paused`, async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const [two, one, none] = cast.elsewhere;
		startedElsewhere(player, "Study desk", {
			plays: two,
			listeners: LISTENERS.map(aDevice),
		});
		startedElsewhere(player, "Attic radio", {
			plays: one,
			listeners: [aDevice("Cellar speaker")],
		});
		const nobody = startedElsewhere(player, "Kitchen tablet", { plays: none });
		expect(nobody.playback()).toBe("paused");
		await openOnThePlayer(page);

		await openPicker(page);

		const heardByTwo = rowLabelled(page, "Study desk");
		await expect(heardByTwo).toContainText(titleOf(two));
		await expect(heardByTwo).toContainText(artistOf(two));
		await expect(heardByTwo).toContainText("2 listening");

		const heardByOne = rowLabelled(page, "Attic radio");
		await expect(heardByOne).toContainText(titleOf(one));
		await expect(heardByOne).toContainText(artistOf(one));
		await expect(heardByOne).toContainText("1 listening");

		const heardByNobody = rowLabelled(page, "Kitchen tablet");
		await expect(heardByNobody).toContainText(titleOf(none));
		await expect(heardByNobody).toContainText(artistOf(none));
		await expect(heardByNobody).toContainText(NOBODY_LISTENING);
		await expect(heardByNobody).not.toContainText(/\d+ listening/);

		for (const name of [...LISTENERS, "Cellar speaker"])
			await expect(playingOn(page).getByText(name)).toHaveCount(0);
		for (const row of [heardByTwo, heardByOne, heardByNobody]) {
			await expect(row).not.toContainText(/playing|paused/i);
			await expect(
				row.getByRole("img", { name: /playing|paused/i }),
			).toHaveCount(0);
		}
	});
});

test.describe("the player's row while the page is in what it started", () => {
	test.use(OFFERING_SESSIONS);

	test("shows what the player plays, and not what the session plays", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const [inTheSession] = cast.elsewhere;
		player.playItem("p7", cast.rowOf(cast.atThePlayer));
		const { strict, refused, started } = await inStartedSession(page, player);
		started.play([inTheSession], 0);
		await expect(statusBar(page)).toContainText(titleOf(inTheSession));

		await expect(playerRowOf(page)).toContainText(titleOf(cast.atThePlayer));
		await expect(playerRowOf(page)).toContainText(artistOf(cast.atThePlayer));
		await expect(playerRowOf(page)).not.toContainText(titleOf(inTheSession));
		strict.release();
		expect(refused).toEqual([]);
	});
});

const nestedControls = (page: Page) =>
	playingOn(page).evaluate((group) => {
		const interactive =
			'button, a[href], input, select, textarea, [role="button"], [role="slider"], [role="switch"], [role="link"]';
		return [...group.querySelectorAll(interactive)]
			.filter((control) => control.parentElement?.closest(interactive))
			.map(
				(control) =>
					control.getAttribute("aria-label") ?? control.textContent ?? "",
			);
	});

test.describe("a row's face, with sessions listed", () => {
	test.use(OFFERING_SESSIONS);

	test("is no button on the row this device hears, nor on the player's row while the page is in what it started, and no control sits inside any face", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		startedElsewhere(player, "Study desk", {
			listeners: [aDevice("Garage radio")],
		});
		startedElsewhere(player, "Attic radio");
		await page.keyboard.press("Escape");
		await openPicker(page);
		await expect(rows(page)).toHaveCount(5);

		await expect(
			ownRow(page).getByRole("button").filter({ hasText: DEVICE_NAME }),
		).toHaveCount(0);
		await expect(
			ownRow(page).getByRole("button", { name: /listen/i }),
		).toHaveCount(0);
		await expect(
			playerRowOf(page).getByRole("button").filter({ hasText: PLAYER_NAME }),
		).toHaveCount(0);
		expect(await nestedControls(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("on the player, no control sits inside the player's face or any other", async ({
		page,
		player,
	}) => {
		startedElsewhere(player, "Study desk", {
			listeners: [aDevice("Garage radio")],
		});
		startedElsewhere(player, "Attic radio");
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rows(page)).toHaveCount(4);
		await expect(thePlayersFace(page)).toBeVisible();

		expect(await nestedControls(page)).toEqual([]);
	});
});

test.describe("the picker's rows from the keyboard", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const cursorRow = (page: Page) =>
		page.locator('[role="row"][data-cursor="true"]');

	const openWithFocusOn = async (page: Page, control: Locator) => {
		await openPicker(page);
		await control.focus();
		await expect(control).toBeFocused();
	};

	test("on the player, Down moves from the player's face to the start row and Up back, and the list behind keeps its cursor", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(cursorRow(page)).toHaveAttribute("data-row", "0");
		await openWithFocusOn(page, thePlayersFace(page));

		await page.keyboard.press("ArrowDown");
		await expect(startButton(page)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(thePlayersFace(page)).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(startButton(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(cursorRow(page)).toHaveAttribute("data-row", "0");
		await untilQuiet(player);
		expect(countPostsTo(player, "/api/volume")).toBe(0);
	});

	test("in what the page started, Down moves from Leave to the start row and Up back, Up never lands on the fader, and the list behind keeps its cursor", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(cursorRow(page)).toHaveAttribute("data-row", "0");
		const refused = refusalsFrom(page);
		await startHere(page, player);
		const strict = await strictOnceSettled(player);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await openWithFocusOn(page, leaveButton(page));

		await page.keyboard.press("ArrowDown");
		await expect(startButton(page)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(leaveButton(page)).toBeFocused();

		await page.keyboard.press("ArrowUp");
		expect(
			await playerRowOf(page)
				.getByRole("slider")
				.evaluate((fader) => fader === document.activeElement),
		).toBe(false);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");

		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(cursorRow(page)).toHaveAttribute("data-row", "0");
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the picker's sheet, scrolled by a touch that begins on a face", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(
		({ isMobile }) => !isMobile,
		"the desktop's popover is driven by a pointer, not a finger",
	);

	const LISTED = 14;

	const listScroll = (page: Page) =>
		playingOn(page).evaluate((group) => {
			for (let at = group.parentElement; at; at = at.parentElement)
				if (at.scrollHeight > at.clientHeight + 1) {
					const { overflowY } = getComputedStyle(at);
					if (overflowY === "auto" || overflowY === "scroll")
						return {
							top: at.scrollTop,
							room: at.scrollHeight - at.clientHeight,
						};
				}
			return null;
		});

	const middleOf = (box: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) => ({
		x: box.x + box.width / 2,
		y: box.y + box.height / 2,
	});

	test("presses neither the player's face nor the start row", async ({
		page,
		player,
	}) => {
		for (let made = 0; made < LISTED; made += 1)
			startedElsewhere(player, `Speaker ${made + 1}`);
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rows(page)).toHaveCount(LISTED + 2);
		await expect
			.poll(async () => (await listScroll(page))?.room ?? 0)
			.toBeGreaterThan(100);

		const face = middleOf(await restingBox(thePlayersFace(page)));
		await touchDrag(page, face, { x: face.x, y: face.y - 200 }, 8);
		await expect
			.poll(async () => (await listScroll(page))?.top ?? 0)
			.toBeGreaterThan(0);

		await startButton(page).scrollIntoViewIfNeeded();
		const start = middleOf(await restingBox(startButton(page)));
		const scrolledTo = (await listScroll(page))?.top ?? 0;
		await touchDrag(page, start, { x: start.x, y: start.y + 200 }, 8);
		await expect
			.poll(async () => (await listScroll(page))?.top ?? 0)
			.toBeLessThan(scrolledTo);

		await untilQuiet(player);
		expect(countPostsTo(player, "/api/stream/ticket")).toBe(0);
		expect(countPostsTo(player, "/api/sessions")).toBe(0);
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(playingOn(page)).toBeVisible();
	});
});

const SHARE = "Let others join";
const SHARE_ON = "Other devices can listen along or control it.";
const SHARE_OFF = "Only the devices already in it can see it.";
const PRIVATE = "Private";
const SESSION_KEY = "jean.session";

const PAST_THE_SECOND_LEAVE_MS = 3_000;

const shareSwitch = (scope: Locator) =>
	scope.getByRole("switch", { name: SHARE, exact: true });

const sharesSent = (player: FakePlayer, id: string) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path.split("?")[0] === `/api/sessions/${id}`,
		)
		.map((entry) => ({
			body: entry.body,
			deviceId: new URL(entry.path, "http://fake").searchParams.get("deviceId"),
		}));

const sharing = (shared: boolean) => ({ body: { shared }, deviceId: DEVICE });

const postsAfter = (player: FakePlayer, from: number) =>
	player.requests
		.slice(from)
		.filter((entry) => entry.method === "POST")
		.map((entry) => `POST ${entry.path.split("?")[0]}`);

const connectionsOf = (session: DetachedSession, deviceId: string) =>
	session.roster().find((device) => device.deviceId === deviceId)
		?.connections ?? 0;

// Playwright runs a page's init scripts again on every reload, so the marker keeps a reload from
// writing back a value the page itself changed or removed.
const storeForThisTab = (page: Page, value: unknown) =>
	page.addInitScript(
		({ key, stored }) => {
			if (sessionStorage.getItem("test.stored")) return;
			sessionStorage.setItem("test.stored", "1");
			sessionStorage.setItem(key, JSON.stringify(stored));
		},
		{ key: SESSION_KEY, stored: value },
	);

const flipSharing = async (
	page: Page,
	session: DetachedSession,
	to: boolean,
) => {
	await shareSwitch(ownRow(page)).click();
	await expect.poll(() => session.shared).toBe(to);
};

const expectReadsPrivate = async (row: Locator) => {
	await expect(shareSwitch(row)).not.toBeChecked();
	await expect(row.getByText(SHARE_OFF, { exact: true })).toBeVisible();
	await expect(row.getByText(SHARE_ON, { exact: true })).toHaveCount(0);
	await expect(row.getByText(PRIVATE, { exact: true })).toBeVisible();
};

const expectReadsShared = async (row: Locator) => {
	await expect(shareSwitch(row)).toBeChecked();
	await expect(row.getByText(SHARE_ON, { exact: true })).toBeVisible();
	await expect(row.getByText(SHARE_OFF, { exact: true })).toHaveCount(0);
	await expect(row.getByText(PRIVATE, { exact: true })).toHaveCount(0);
};

const streamOf = (page: Page) => {
	const seen = { asked: 0, ended: 0 };
	const isStream = (request: { method: () => string; url: () => string }) =>
		request.method() === "GET" &&
		new URL(request.url()).pathname === "/api/stream";
	page.on("request", (request) => {
		const { pathname } = new URL(request.url());
		if (isStream(request) || pathname === "/api/stream/ticket") seen.asked += 1;
	});
	const ended = (request: { method: () => string; url: () => string }) => {
		if (isStream(request)) seen.ended += 1;
	};
	page.on("requestfinished", ended);
	page.on("requestfailed", ended);
	return seen;
};

const pollsSentBy = (page: Page) => {
	const named: (string | null)[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (request.method() === "GET" && url.pathname === "/api/state")
			named.push(url.searchParams.get("session"));
	});
	return named;
};

test.describe("sharing what this device started", () => {
	test.use(OFFERING_SESSIONS);

	test(`starts private: the player holds it unshared, and its row reads "${PRIVATE}" with "${SHARE}" off and "${SHARE_OFF}" under it`, async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);

		expect(started.shared).toBe(false);
		await expectReadsPrivate(ownRow(page));
		const at = {
			toggle: await restingBox(shareSwitch(ownRow(page))),
			sentence: await restingBox(
				ownRow(page).getByText(SHARE_OFF, { exact: true }),
			),
		};
		expect(at.sentence.y).toBeGreaterThan(at.toggle.y);
		await expect(
			playingOn(page).getByText(PRIVATE, { exact: true }),
		).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("each flip sends one change naming this device, and the row and the player follow it", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);

		await shareSwitch(ownRow(page)).click();
		await expectSettlesAt(player, () => sharesSent(player, started.id), [
			sharing(true),
		]);
		expect(started.shared).toBe(true);
		await expectReadsShared(ownRow(page));

		await shareSwitch(ownRow(page)).click();
		await expectSettlesAt(player, () => sharesSent(player, started.id), [
			sharing(true),
			sharing(false),
		]);
		expect(started.shared).toBe(false);
		await expectReadsPrivate(ownRow(page));
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the switch stands in the row this tab is in and no other", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		await expect(rows(page)).toHaveCount(3);

		await expect(playingOn(page).getByRole("switch")).toHaveCount(1);
		await expect(shareSwitch(ownRow(page))).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("on the player, the picker holds no switch and nothing reads private", async ({
		page,
		player,
	}) => {
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(startButton(page)).toBeVisible();
		await untilQuiet(player);

		expect(await playingOn(page).getByRole("switch").count()).toBe(0);
		expect(
			await playingOn(page).getByText(PRIVATE, { exact: true }).count(),
		).toBe(0);
	});

	test("a page loaded again into what it shared reads it shared, and sends no change", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await flipSharing(page, started, true);
		await untilQuiet(player);

		await page.reload();
		await openPicker(page);

		await expectReadsShared(ownRow(page));
		await expectSettlesAt(player, () => sharesSent(player, started.id), [
			sharing(true),
		]);
		expect(started.shared).toBe(true);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("stopping sharing disconnects nobody", () => {
	test.use(OFFERING_SESSIONS);

	test("a second page of this browser listening to it keeps its stream and its poll, and reads it private", async ({
		page,
		player,
	}) => {
		const { refused, started } = await inStartedSession(page, player);
		await flipSharing(page, started, true);

		const beside = await page.context().newPage();
		await storeForThisTab(beside, { id: started.id, listening: true });
		const refusedBeside = refusalsFrom(beside);
		const stream = streamOf(beside);
		const polls = pollsSentBy(beside);
		await beside.goto(ROUTE_WITH_NO_LIST);
		await openPicker(beside);
		await playingOn(beside)
			.getByRole("button", { name: "Start playing", exact: true })
			.click();
		await expect.poll(() => connectionsOf(started, DEVICE)).toBe(2);
		await expectReadsShared(ownRow(beside));
		const strict = await strictOnceSettled(player);
		const streamBefore = { ...stream };

		await flipSharing(page, started, false);
		await expectReadsPrivate(ownRow(beside));
		const from = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(from + 1);
		await untilQuiet(player);

		expect(stream).toEqual(streamBefore);
		expect(connectionsOf(started, DEVICE)).toBe(2);
		expect(polls.slice(from)).toEqual(polls.slice(from).map(() => started.id));
		expect(sharesSent(player, started.id)).toEqual([
			sharing(true),
			sharing(false),
		]);
		expect(player.sessions.find(started.id)).toBe(started);
		strict.release();
		expect(refused).toEqual([]);
		expect(refusedBeside).toEqual([]);
	});

	// `foo_jean` does nothing with a leave naming a device that still holds a connection, and neither
	// does the fake, so a leave sent for the other device is caught on the wire rather than in the
	// roster.
	test("another device listening keeps its connection, the session goes on, and the flip is the only write", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await flipSharing(page, started, true);
		const other = aDevice("Garage radio");
		player.addSessionListener(started.id, other);
		await untilQuiet(player);
		const from = player.requests.length;

		await shareSwitch(ownRow(page)).click();
		await expectSettlesAt(player, () => postsAfter(player, from), [
			`POST /api/sessions/${started.id}`,
		]);

		expect(started.shared).toBe(false);
		expect(sharesSent(player, started.id).at(-1)).toEqual(sharing(false));
		expect(connectionsOf(started, other.deviceId)).toBe(1);
		expect(connectionsOf(started, DEVICE)).toBe(1);
		expect(player.sessions.find(started.id)).toBe(started);
		await expectReadsPrivate(ownRow(page));
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("nothing ends a session for another device in it", () => {
	test.use(OFFERING_SESSIONS);

	test("the row this tab is in offers Leave and the switch and nothing else, and Leave leaves the session to the other device", async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		const other = aDevice("Garage radio");
		player.addSessionListener(started.id, other);
		await expect(ownRow(page)).toContainText("Garage radio");
		await untilQuiet(player);

		const named = (controls: Locator) =>
			controls.evaluateAll((found) =>
				found.map(
					(control) =>
						control.getAttribute("aria-label") ?? control.textContent,
				),
			);
		expect(await named(ownRow(page).getByRole("button"))).toEqual([
			LEAVE_NAMED,
		]);
		expect(await ownRow(page).getByRole("switch").count()).toBe(1);
		await expect(shareSwitch(ownRow(page))).toBeVisible();
		expect(await ownRow(page).getByRole("slider").count()).toBe(0);
		expect(
			await playingOn(page)
				.getByRole("button", { name: /\b(end|stop)\b/i })
				.count(),
		).toBe(0);

		strict.release();
		await leaveButton(page).click();
		await expect(currentRows(page)).toContainText(PLAYER_NAME);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);

		expect(player.sessions.find(started.id)).toBe(started);
		expect(listensIn(started)).toBe(false);
		expect(connectionsOf(started, other.deviceId)).toBe(1);
		const leaves = player.requests.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path.split("?")[0] === "/api/stream/leave",
		);
		expect(leaves.length).toBeGreaterThan(0);
		expect(leaves.map((entry) => entry.body?.deviceId)).toEqual(
			leaves.map(() => DEVICE),
		);
		expect(refused).toEqual([]);
	});
});

test.describe("sharing what another device started and shared", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test(`offers the switch on, with "${SHARE_ON}", and one flip off sends one change and reads "${PRIVATE}"`, async ({
		page,
		player,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		await storeForThisTab(page, { id: session.id, listening: false });
		const refused = refusalsFrom(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(
			`Playing what ${CREATOR} started`,
		);
		const strict = await strictOnceSettled(player);
		await openPicker(page);
		const row = rowLabelled(page, CREATOR);

		await expectReadsShared(row);
		expect(
			await playingOn(page).getByText(PRIVATE, { exact: true }).count(),
		).toBe(0);

		await shareSwitch(row).click();
		await expectSettlesAt(player, () => sharesSent(player, session.id), [
			sharing(false),
		]);
		expect(session.shared).toBe(false);
		await expectReadsPrivate(row);
		expect(player.sessions.find(session.id)).toBe(session);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the sharing switch on a phone", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(({ isMobile }) => !isMobile, "these are a finger's sizes");

	const FINGER_PX = 44;
	const SWITCH_ROW_PX = 52;

	const switchRow = (toggle: Locator) =>
		toggle.evaluate((element, name) => {
			let at: Element | null = element;
			while (at && !at.textContent?.includes(name)) at = at.parentElement;
			if (!at) return null;
			const { height } = at.getBoundingClientRect();
			const holdsALeave = [...at.querySelectorAll("button")].some((button) =>
				(button.getAttribute("aria-label") ?? "").startsWith("Leave"),
			);
			return { height, holdsALeave };
		}, SHARE);

	test("the switch row is at least 52 pixels tall and the switch takes a touch 44 by 44", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		const toggle = shareSwitch(ownRow(page));
		await expect(toggle).toBeVisible();

		const box = await restingBox(toggle);
		expect(box.height, "the switch: height").toBeGreaterThanOrEqual(FINGER_PX);
		expect(box.width, "the switch: width").toBeGreaterThanOrEqual(FINGER_PX);
		const row = await switchRow(toggle);
		expect(row?.holdsALeave, "the switch row holds Leave").toBe(false);
		expect(row?.height ?? 0, "the switch row: height").toBeGreaterThanOrEqual(
			SWITCH_ROW_PX,
		);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const JOIN = "Listen";
const GONE_BEFORE_JOIN = "This ended before you could join.";
const ONLY_LISTENER = "Only this device is listening, so leaving ends it.";

const joinNamed = (device: string) => `Listen to what ${device} started`;

const faceOf = (page: Page, device: string) =>
	playingOn(page).getByRole("button", {
		name: joinNamed(device),
		exact: true,
	});

const ticketsAfter = (player: FakePlayer, from: number) =>
	player.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path.split("?")[0] === "/api/stream/ticket",
		)
		.map((entry) => ({
			session: new URL(entry.path, "http://fake").searchParams.get("session"),
			deviceId: entry.body?.deviceId ?? null,
			name: entry.body?.name ?? null,
		}));

const stepsAfter = (
	player: FakePlayer,
	from: number,
	known: Record<string, string>,
) =>
	player.requests.slice(from).flatMap((entry) => {
		if (entry.method !== "POST") return [];
		const url = new URL(entry.path, "http://fake");
		const verb =
			url.pathname === "/api/stream/ticket"
				? "ticket"
				: url.pathname === "/api/stream/leave"
					? "leave"
					: null;
		if (!verb) return [];
		const session = url.searchParams.get("session");
		return [
			`${verb} ${session === null ? "the player" : (known[session] ?? session)}`,
		];
	});

const wireOf = (page: Page, known: () => Record<string, string>) => {
	const seen: string[] = [];
	const routeOf = (request: { method: () => string; url: () => string }) => {
		const url = new URL(request.url());
		return { route: `${request.method()} ${url.pathname}`, url };
	};
	const naming = (url: URL) => {
		const session = url.searchParams.get("session");
		return session === null ? "the player" : (known()[session] ?? session);
	};
	page.on("request", (request) => {
		const { route, url } = routeOf(request);
		if (route === "POST /api/stream/ticket") seen.push(`ticket ${naming(url)}`);
		if (route === "POST /api/stream/leave") seen.push(`leave ${naming(url)}`);
		if (route === "GET /api/stream") seen.push("stream opened");
	});
	const closed = (request: { method: () => string; url: () => string }) => {
		if (routeOf(request).route === "GET /api/stream")
			seen.push("stream closed");
	};
	page.on("requestfinished", closed);
	page.on("requestfailed", closed);
	return seen;
};

const dialogsOn = (page: Page) => {
	const asked: string[] = [];
	page.on("dialog", (dialog) => {
		asked.push(dialog.message());
		void dialog.dismiss();
	});
	return asked;
};

const watchThePage = (page: Page, phrases: string[]) =>
	page.addInitScript((watched) => {
		const toasts = new Set<string>();
		const shown = new Set<string>();
		Object.assign(window, { watchedToasts: toasts, watchedShown: shown });
		const look = () => {
			for (const dismiss of document.querySelectorAll(
				'[role="status"] button[aria-label="Dismiss"]',
			))
				toasts.add(dismiss.parentElement?.textContent ?? "");
			const text = document.body?.textContent ?? "";
			for (const phrase of watched)
				if (text.includes(phrase)) shown.add(phrase);
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, phrases);

const watched = (page: Page) =>
	page.evaluate(() => {
		const held = window as unknown as {
			watchedToasts: Set<string>;
			watchedShown: Set<string>;
		};
		return {
			toasts: [...held.watchedToasts],
			shown: [...held.watchedShown],
		};
	});

const storedSession = (page: Page) =>
	page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);

const playerStopButton = (page: Page) =>
	playerRowOf(page).getByRole("button", {
		name: /^(Stop, and move the sound back to |Stop listening here)/,
	});

const listenToThePlayer = async (page: Page, player: FakePlayer) => {
	await thePlayersFace(page).click();
	await expect(playerStopButton(page)).toBeVisible();
	await expect.poll(() => player.openStreams).toBe(1);
	await expect.poll(() => player.streamDevices.has(DEVICE)).toBe(true);
};

const closeThePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile)
		await page
			.getByRole("dialog", { name: "Playing on" })
			.getByRole("button", { name: "Close", exact: true })
			.click();
	else await page.keyboard.press("Escape");
	await expect(playingOn(page)).toBeHidden();
};

const refuseTicketsFor = (
	page: Page,
	session: DetachedSession,
	error: string,
) =>
	page.route(
		(url) =>
			url.pathname === "/api/stream/ticket" &&
			url.searchParams.get("session") === session.id,
		(route) =>
			route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ error }),
			}),
	);

test.describe("joining to listen from the picker, on the player", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test(`a row this tab does not hear is a face reading "${JOIN}" and named "${joinNamed(CREATOR)}"`, async ({
		page,
		player,
	}) => {
		startedElsewhere(player, CREATOR);
		await openOnThePlayer(page);
		await openPicker(page);

		await expect(faceOf(page, CREATOR)).toBeVisible();
		await expect(
			faceOf(page, CREATOR).getByText(JOIN, { exact: true }),
		).toBeVisible();
		await expect(rowLabelled(page, CREATOR).getByRole("button")).toHaveCount(1);
	});

	test("pressing it takes one ticket naming the session and this device, opens its stream, and from then the poll names it", async ({
		page,
		player,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const polls = pollsSentBy(page);
		await openPicker(page);
		await untilQuiet(player);
		const from = player.requests.length;

		await faceOf(page, CREATOR).click();

		await expect.poll(() => listensIn(session)).toBe(true);
		const strict = await strictOnceSettled(player);
		expect(ticketsAfter(player, from)).toEqual([
			{ session: session.id, deviceId: DEVICE, name: DEVICE_NAME },
		]);
		const settled = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(settled);
		expect(polls.slice(settled)).toEqual(
			polls.slice(settled).map(() => session.id),
		);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: true,
		});
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the picker stays open with the joined row current, and on the desktop focus lands on its Leave", async ({
		page,
		player,
		isMobile,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		await openPicker(page);

		await faceOf(page, CREATOR).click();
		await expect.poll(() => listensIn(session)).toBe(true);
		const strict = await strictOnceSettled(player);

		await expect(playingOn(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(
			currentRows(page).getByText(CREATOR, { exact: true }),
		).toHaveCount(1);
		if (isMobile)
			await expect(
				page.getByRole("dialog", { name: "Playing on" }),
			).toBeVisible();
		else
			await expect(
				rowLabelled(page, CREATOR).getByRole("button", {
					name: LEAVE_NAMED,
					exact: true,
				}),
			).toBeFocused();
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the joined row's face is no button, and the row beside it still offers listening", async ({
		page,
		player,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		startedElsewhere(player, "Attic radio");
		const refused = await openOnThePlayer(page);
		await openPicker(page);

		await faceOf(page, CREATOR).click();
		await expect.poll(() => listensIn(session)).toBe(true);
		const strict = await strictOnceSettled(player);
		await expect(leaveButton(page)).toBeVisible();

		await expect(faceOf(page, CREATOR)).toHaveCount(0);
		await expect(
			rowLabelled(page, CREATOR).getByRole("button", { name: /listen/i }),
		).toHaveCount(0);
		await expect(
			rowLabelled(page, CREATOR)
				.getByRole("button")
				.filter({ hasText: CREATOR }),
		).toHaveCount(0);
		await expect(faceOf(page, "Attic radio")).toBeVisible();
		expect(await nestedControls(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("a session another device started, where the install cannot stream", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { maxSessions: 4, canCreateSessions: true, canStream: false },
	});

	test("draws no row for it, and the list is never read", async ({
		page,
		player,
	}) => {
		startedElsewhere(player, "Kitchen tablet");
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(statusBar(page)).toBeVisible();
		await untilTheInstallIsKnown(player);
		await untilQuiet(player);

		await expect(opener(page)).toHaveCount(0);
		await expect(page.getByText("Kitchen tablet")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: joinNamed("Kitchen tablet") }),
		).toHaveCount(0);
		expect(sessionReads(player)).toEqual([]);
	});
});

test.describe("joining while this device listens to the player", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("sends the player's leave before the session's ticket, and ends off the player's stream and on the session's", async ({
		page,
		player,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		const known = { [session.id]: CREATOR };
		const refused = await openOnThePlayer(page);
		const wire = wireOf(page, () => known);
		await openPicker(page);
		await listenToThePlayer(page, player);
		await untilQuiet(player);
		const from = player.requests.length;
		const seenFrom = wire.length;

		await faceOf(page, CREATOR).click();
		await expect.poll(() => listensIn(session)).toBe(true);
		const strict = await strictOnceSettled(player);

		expect(stepsAfter(player, from, known)).toEqual([
			"leave the player",
			`ticket ${CREATOR}`,
		]);
		await expect
			.poll(() => wire.slice(seenFrom))
			.toEqual(expect.arrayContaining(["stream closed", "stream opened"]));
		await expectSettlesAt(player, () => player.openStreams, 1);
		expect(player.streamDevices.has(DEVICE)).toBe(false);
		expect(connectionsOf(session, DEVICE)).toBe(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	for (const refusal of [
		"refused with a 503",
		"ended before the press",
	] as const)
		test(`a ticket ${refusal} puts the player's stream back: one more ticket for the player, the stream open, the tab on the player listening, and no toast saying anything ended`, async ({
			page,
			player,
		}) => {
			const session = startedElsewhere(player, CREATOR);
			const known = { [session.id]: CREATOR };
			await watchThePage(page, [GONE_BEFORE_JOIN]);
			const refused = await openOnThePlayer(page);
			const wire = wireOf(page, () => known);
			const polls = pollsSentBy(page);
			await openPicker(page);
			await listenToThePlayer(page, player);
			await untilQuiet(player);
			const from = player.requests.length;
			const seenFrom = wire.length;
			if (refusal === "refused with a 503")
				await refuseTicketsFor(page, session, "stream unavailable");
			else player.endSession(session.id);

			await faceOf(page, CREATOR).click();

			await expect(playerStopButton(page)).toBeVisible();
			// When the browser reports the player's stream closed, against the leave sent in the same
			// tick, is the browser's to order.
			await expect
				.poll(() =>
					wire.slice(seenFrom).filter((step) => step !== "stream closed"),
				)
				.toEqual([
					"leave the player",
					`ticket ${CREATOR}`,
					"ticket the player",
					"stream opened",
				]);
			await expect.poll(() => wire.slice(seenFrom)).toContain("stream closed");
			await expect.poll(() => player.openStreams).toBe(1);
			await untilQuiet(player);
			expect(
				stepsAfter(player, from, known).filter((step) =>
					step.startsWith("ticket the player"),
				),
			).toEqual(["ticket the player"]);
			expect(listensIn(session)).toBe(false);
			expect(await storedSession(page)).toBeNull();
			await expect(currentRows(page)).toHaveCount(1);
			await expect(
				currentRows(page).getByText(PLAYER_NAME, { exact: true }),
			).toHaveCount(1);
			const settled = polls.length;
			await expect.poll(() => polls.length).toBeGreaterThan(settled);
			expect(polls.slice(settled)).toEqual(
				polls.slice(settled).map(() => null),
			);
			expect(
				(await watched(page)).toasts.filter((said) => /ended/i.test(said)),
			).toEqual([]);
			if (refusal === "ended before the press")
				await expect(
					rowLabelled(page, CREATOR).getByText(GONE_BEFORE_JOIN, {
						exact: true,
					}),
				).toBeVisible();
			expect(refused).toEqual([]);
		});
});

test.describe("switching from what the page started to what another device started", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("takes the new ticket before the old leave, ends what the page started with nothing asked, and listens in the new one with the picker open", async ({
		page,
		player,
		isMobile,
	}) => {
		const asked = dialogsOn(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		const polls = pollsSentBy(page);
		const target = startedElsewhere(player, CREATOR);
		const known = { [started.id]: "what it started", [target.id]: CREATOR };
		await expect(faceOf(page, CREATOR)).toBeVisible();
		await untilQuiet(player);
		const from = player.requests.length;

		await faceOf(page, CREATOR).click();

		await expect.poll(() => listensIn(target)).toBe(true);
		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await untilQuiet(player);
		const steps = stepsAfter(player, from, known);
		expect(steps[0]).toBe(`ticket ${CREATOR}`);
		expect(steps).toContain("leave what it started");
		expect(steps.indexOf(`ticket ${CREATOR}`)).toBeLessThan(
			steps.indexOf("leave what it started"),
		);
		expect(steps.filter((step) => step.startsWith("ticket"))).toEqual([
			`ticket ${CREATOR}`,
		]);
		expect(asked).toEqual([]);
		await expect(page.getByRole("alertdialog")).toHaveCount(0);

		await expect(playingOn(page)).toBeVisible();
		await expect(
			currentRows(page).getByText(CREATOR, { exact: true }),
		).toHaveCount(1);
		if (!isMobile)
			await expect(
				rowLabelled(page, CREATOR).getByRole("button", {
					name: LEAVE_NAMED,
					exact: true,
				}),
			).toBeFocused();
		const settled = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(settled);
		expect(polls.slice(settled)).toEqual(
			polls.slice(settled).map(() => target.id),
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`what ended between the list and the press stays in its place reading "${GONE_BEFORE_JOIN}" until the picker closes, and the page keeps listening where it was`, async ({
		page,
		player,
		isMobile,
	}) => {
		const cast = oneOffEachRecord(player);
		const { strict, refused, started } = await inStartedSession(page, player);
		const wire = wireOf(page, () => ({}));
		const polls = pollsSentBy(page);
		const gone = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		startedElsewhere(player, "Attic radio");
		const order = [PLAYER_NAME, DEVICE_NAME, CREATOR, "Attic radio", START];
		await expectRowsInOrder(page, order);
		await untilQuiet(player);
		player.endSession(gone.id);
		const seenFrom = wire.length;
		const readsFrom = sessionReads(player).length;

		await faceOf(page, CREATOR).click();

		const row = rowLabelled(page, CREATOR);
		await expect(
			row.getByText(GONE_BEFORE_JOIN, { exact: true }),
		).toBeVisible();
		await expect(row.getByRole("button")).toHaveCount(0);
		await expect(row).not.toContainText(titleOf(cast.elsewhere[0]));
		await expect
			.poll(() => sessionReads(player).length)
			.toBeGreaterThan(readsFrom);
		await untilQuiet(player);
		await expectRowsInOrder(page, order);
		await expect(
			row.getByText(GONE_BEFORE_JOIN, { exact: true }),
		).toBeVisible();

		expect(
			wire.slice(seenFrom).filter((step) => step.startsWith("stream")),
		).toEqual([]);
		expect(connectionsOf(started, DEVICE)).toBe(1);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: started.id,
			listening: true,
		});
		const settled = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(settled);
		expect(polls.slice(settled)).toEqual(
			polls.slice(settled).map(() => started.id),
		);

		await closeThePicker(page, isMobile);
		await openPicker(page);
		await expectRowsInOrder(page, [
			PLAYER_NAME,
			DEVICE_NAME,
			"Attic radio",
			START,
		]);
		await expect(playingOn(page).getByText(GONE_BEFORE_JOIN)).toHaveCount(0);
		strict.release();
		expect(refused).toEqual([]);
	});

	// `foo_jean` counts `maxSessions` only for a create, so the cap a join meets is another.
	for (const error of ["stream unavailable", "too many listeners"])
		test(`a ticket refused with a 503 saying "${error}" leaves the page listening where it was, on the same connection, with the picker open`, async ({
			page,
			player,
		}) => {
			const { strict, refused, started } = await inStartedSession(page, player);
			const wire = wireOf(page, () => ({}));
			const polls = pollsSentBy(page);
			const target = startedElsewhere(player, CREATOR);
			await expect(faceOf(page, CREATOR)).toBeVisible();
			await untilQuiet(player);
			const seenFrom = wire.length;
			const from = player.requests.length;
			player.fooJean.failTickets = 503;
			player.fooJean.ticketError = error;

			await faceOf(page, CREATOR).click();

			await expect
				.poll(() => ticketsAfter(player, from).map((ticket) => ticket.session))
				.toContain(target.id);
			await untilQuiet(player);
			expect(
				stepsAfter(player, from, {}).filter((step) => step.startsWith("leave")),
			).toEqual([]);
			expect(
				wire.slice(seenFrom).filter((step) => step.startsWith("stream")),
			).toEqual([]);
			expect(player.sessions.find(started.id)).toBe(started);
			expect(connectionsOf(started, DEVICE)).toBe(1);
			expect(listensIn(target)).toBe(false);
			await expect(playingOn(page)).toBeVisible();
			await expect(
				currentRows(page).getByText(DEVICE_NAME, { exact: true }),
			).toHaveCount(1);
			await expect(leaveButton(page)).toBeVisible();
			expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
				id: started.id,
				listening: true,
			});
			const settled = polls.length;
			await expect.poll(() => polls.length).toBeGreaterThan(settled);
			expect(polls.slice(settled)).toEqual(
				polls.slice(settled).map(() => started.id),
			);
			player.fooJean.failTickets = null;
			strict.release();
			expect(refused).toEqual([]);
		});

	test("a second page of this browser listening to what the first started keeps its stream and its poll, and what it started goes on", async ({
		page,
		player,
	}) => {
		const { refused, started } = await inStartedSession(page, player);
		const target = startedElsewhere(player, CREATOR);
		await expect(faceOf(page, CREATOR)).toBeVisible();

		const beside = await page.context().newPage();
		await storeForThisTab(beside, { id: started.id, listening: true });
		const refusedBeside = refusalsFrom(beside);
		const stream = streamOf(beside);
		const polls = pollsSentBy(beside);
		await beside.goto(ROUTE_WITH_NO_LIST);
		await openPicker(beside);
		await playingOn(beside)
			.getByRole("button", { name: "Start playing", exact: true })
			.click();
		await expect.poll(() => connectionsOf(started, DEVICE)).toBe(2);
		const strict = await strictOnceSettled(player);
		const streamBefore = { ...stream };

		await faceOf(page, CREATOR).click();
		await expect.poll(() => listensIn(target)).toBe(true);
		await expect
			.poll(() => countPostsToSession(player, "/api/stream/leave", started.id))
			.toBeGreaterThan(0);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		const from = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(from + 1);

		expect(player.sessions.find(started.id)).toBe(started);
		expect(connectionsOf(started, DEVICE)).toBe(1);
		expect(stream).toEqual(streamBefore);
		expect(polls.slice(from)).toEqual(polls.slice(from).map(() => started.id));
		await expect(
			ownRow(beside).getByRole("button", { name: LEAVE_NAMED }),
		).toBeVisible();
		strict.release();
		expect(refused).toEqual([]);
		expect(refusedBeside).toEqual([]);
	});
});

test.describe("leaving what another device started, once joined", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("Leave sends the leave naming it and puts the page on the player without listening, the session goes on for the device that started it, and no line said leaving ends it", async ({
		page,
		player,
	}) => {
		const creator = aDevice(CREATOR);
		const session = startedElsewhere(player, creator, { listeners: [creator] });
		await watchThePage(page, [ONLY_LISTENER]);
		const refused = await openOnThePlayer(page);
		const polls = pollsSentBy(page);
		await openPicker(page);
		await faceOf(page, CREATOR).click();
		await expect.poll(() => listensIn(session)).toBe(true);
		const strict = await strictOnceSettled(player);
		await expect(rowLabelled(page, CREATOR)).toContainText("Also listening");
		await untilQuiet(player);
		const from = player.requests.length;

		strict.release();
		await leaveButton(page).click();

		await expect(thePlayersFace(page)).toBeVisible();
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		const steps = stepsAfter(player, from, { [session.id]: CREATOR });
		expect(steps.length).toBeGreaterThan(0);
		expect(steps).toEqual(steps.map(() => `leave ${CREATOR}`));
		expect(
			player.requests
				.slice(from)
				.filter((entry) => entry.path.split("?")[0] === "/api/stream/leave")
				.map((entry) => entry.body?.deviceId),
		).toEqual(steps.map(() => DEVICE));
		expect(player.sessions.find(session.id)).toBe(session);
		expect(listensIn(session)).toBe(false);
		expect(connectionsOf(session, creator.deviceId)).toBe(1);
		expect(player.openStreams).toBe(0);
		expect(await storedSession(page)).toBeNull();
		const settled = polls.length;
		await expect.poll(() => polls.length).toBeGreaterThan(settled);
		expect(polls.slice(settled)).toEqual(polls.slice(settled).map(() => null));
		expect((await watched(page)).shown).toEqual([]);
		expect(refused).toEqual([]);
	});
});

test.describe("the position after a switch while listening", () => {
	test.use(OFFERING_SESSIONS);

	const seekBar = (page: Page) =>
		statusBar(page).getByRole("slider", { name: "Position" });

	const position = async (page: Page) =>
		Number(await seekBar(page).getAttribute("aria-valuenow"));

	const HEARD_FOR_SECONDS = 2;

	test("reads the new session's, though both play one track", async ({
		page,
		player,
	}) => {
		const library = player.playlistById("p7")?.items ?? [];
		const track = library.find(
			(entry) => Number(field(entry, "%length_seconds%")) >= 200,
		);
		if (!track) throw new Error("the library holds no track of 200 seconds");
		const length = Number(field(track, "%length_seconds%"));
		const LEFT_AT = 10;
		const JOINED_AT = length - 40;

		const { strict, refused, started } = await inStartedSession(page, player);
		started.play([track], 0);
		started.seek({ seconds: LEFT_AT });
		player.addSessionListener(started.id, aDevice("Garage radio"));
		const target = startedElsewhere(player, "Kitchen tablet", { plays: track });
		target.seek({ seconds: JOINED_AT });
		expect(target.timelineRevision).toBe(started.timelineRevision);
		await expect(statusBar(page)).toContainText(titleOf(track));
		await expect.poll(() => position(page)).toBeGreaterThanOrEqual(LEFT_AT);
		expect(await position(page)).toBeLessThan(JOINED_AT - 60);
		await expect(faceOf(page, "Kitchen tablet")).toBeVisible();

		await faceOf(page, "Kitchen tablet").click();
		await expect.poll(() => listensIn(target)).toBe(true);
		await expect(
			statusBar(page).getByRole("button", { name: /^Pause($| \()/ }),
		).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0),
			)
			.toBeGreaterThanOrEqual(HEARD_FOR_SECONDS);

		const heard = await position(page);
		expect(heard).toBeGreaterThanOrEqual(JOINED_AT);
		expect(heard).toBeLessThanOrEqual(length);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the listed rows' faces from the keyboard", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const SELECTED_ROW = 2;
	const LISTED = ["Study desk", "Attic radio"];

	const withARowSelected = async (page: Page, player: FakePlayer) => {
		await openLibrary(page);
		await trackRow(page, SELECTED_ROW).click();
		await expect(trackRow(page, SELECTED_ROW)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await untilQuiet(player);
		const played = () =>
			playRequests(player).length +
			countPostsTo(player, "/api/playback/play-pause");
		const before = played();
		return async () => {
			await untilQuiet(player);
			return played() - before;
		};
	};

	test("Down moves from the player's face to each listed face in turn and then the start row, and Up back", async ({
		page,
		player,
	}) => {
		for (const label of LISTED) startedElsewhere(player, label);
		const played = await withARowSelected(page, player);
		await openPicker(page);
		await expect(faceOf(page, LISTED[1])).toBeVisible();
		await thePlayersFace(page).focus();

		await page.keyboard.press("ArrowDown");
		await expect(faceOf(page, LISTED[0])).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(faceOf(page, LISTED[1])).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(startButton(page)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(faceOf(page, LISTED[1])).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(faceOf(page, LISTED[0])).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(thePlayersFace(page)).toBeFocused();

		expect(await played()).toBe(0);
		expect(countPostsTo(player, "/api/stream/ticket")).toBe(0);
	});

	for (const key of ["Enter", "Space"])
		test(`${key} on a listed face listens to it, leaves focus on its Leave, and plays nothing in the list`, async ({
			page,
			player,
		}) => {
			const [first] = LISTED.map((label) => startedElsewhere(player, label));
			const played = await withARowSelected(page, player);
			const refused = refusalsFrom(page);
			await openPicker(page);
			await faceOf(page, LISTED[0]).focus();
			await untilQuiet(player);
			const from = player.requests.length;

			await page.keyboard.press(key);

			await expect.poll(() => listensIn(first)).toBe(true);
			const strict = await strictOnceSettled(player);
			expect(
				ticketsAfter(player, from).map((ticket) => ticket.session),
			).toEqual([first.id]);
			await expect(
				rowLabelled(page, LISTED[0]).getByRole("button", {
					name: LEAVE_NAMED,
					exact: true,
				}),
			).toBeFocused();
			expect(await played()).toBe(0);
			strict.release();
			expect(refused).toEqual([]);
		});
});

test.describe("the picker's sheet, scrolled by a touch that begins on a listed face", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(
		({ isMobile }) => !isMobile,
		"the desktop's popover is driven by a pointer, not a finger",
	);

	const LISTED = 14;

	const listScrollTop = (page: Page) =>
		playingOn(page).evaluate((group) => {
			for (let at = group.parentElement; at; at = at.parentElement) {
				const { overflowY } = getComputedStyle(at);
				if (
					at.scrollHeight > at.clientHeight + 1 &&
					(overflowY === "auto" || overflowY === "scroll")
				)
					return at.scrollTop;
			}
			return null;
		});

	test("joins nothing", async ({ page, player }) => {
		for (let made = 0; made < LISTED; made += 1)
			startedElsewhere(player, `Speaker ${made + 1}`);
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rows(page)).toHaveCount(LISTED + 2);
		const face = faceOf(page, "Speaker 3");
		await expect(face).toBeVisible();
		await expect.poll(() => listScrollTop(page)).toBe(0);

		const box = await restingBox(face);
		const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		await touchDrag(page, from, { x: from.x, y: from.y - 200 }, 8);
		await expect
			.poll(async () => (await listScrollTop(page)) ?? 0)
			.toBeGreaterThan(0);

		await untilQuiet(player);
		expect(countPostsTo(player, "/api/stream/ticket")).toBe(0);
		expect(player.sessions.list().some(listensIn)).toBe(false);
		await expect(playingOn(page)).toBeVisible();
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
	});
});

const ALSO_LISTENING = "Also listening";

const PLAYER_LISTENER = "Living room phone";
const LEFT_LISTENERS = ["Garage radio", "Attic speaker"];
const JOINED_CREATOR = "Kitchen tablet";
const JOINED_LISTENER = "Porch speaker";
const LISTED_LISTENERS = ["Hall speaker", "Bath radio"];

const EVERY_NAME = [
	PLAYER_LISTENER,
	...LEFT_LISTENERS,
	JOINED_LISTENER,
	...LISTED_LISTENERS,
	DEVICE_NAME,
	THIS_DEVICE,
];

const rosterIn = (scope: Locator) =>
	scope.getByRole("list", { name: ALSO_LISTENING, exact: true });

const namesIn = async (scope: Locator) => {
	const entries = await rosterIn(scope).getByRole("listitem").allTextContents();
	return entries
		.map((entry) => EVERY_NAME.find((name) => entry.startsWith(name)) ?? entry)
		.sort();
};

const sorted = (names: string[]) => [...names].sort();

const rosterReads = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" &&
				entry.path.split("?")[0] === "/api/stream/listeners",
		)
		.map((entry) => {
			const query = new URL(entry.path, "http://fake").searchParams;
			return { session: query.get("session"), deviceId: query.get("deviceId") };
		});

const watchRows = (page: Page, watched: { row: string; names: string[] }[]) =>
	page.addInitScript((rowsWatched) => {
		const seen = new Set<string>();
		Object.assign(window, { rowsSeen: seen });
		const look = () => {
			for (const row of document.querySelectorAll('[role="group"] li')) {
				if (row.parentElement?.closest("li")) continue;
				const labels = [...row.querySelectorAll("*")].map((element) =>
					element.textContent?.trim(),
				);
				const text = row.textContent ?? "";
				for (const { row: label, names } of rowsWatched) {
					if (!labels.includes(label)) continue;
					for (const name of names)
						if (text.includes(name)) seen.add(`${label}: ${name}`);
				}
			}
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, watched);

const seenInRows = (page: Page) =>
	page.evaluate(() => [
		...(window as unknown as { rowsSeen: Set<string> }).rowsSeen,
	]);

const withListeners = (player: FakePlayer, id: string, names: string[]) =>
	names.map((name) => player.addSessionListener(id, aDevice(name)));

test.describe("each session's roster in the picker", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: {
			...OFFERING_SESSIONS.fooJean,
			otherListeners: [
				{
					deviceId: "player-listener",
					name: PLAYER_LISTENER,
					listeningFor: 60,
				},
			],
		},
	});

	test(`listening to what it started, the row this tab is in lists the session's other listeners under "${ALSO_LISTENING}", read naming the session, and no other row holds a roster`, async ({
		page,
		player,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		const from = rosterReads(player).length;
		withListeners(player, started.id, LEFT_LISTENERS);
		startedElsewhere(player, "Study desk", {
			listeners: LISTED_LISTENERS.map((name) => aDevice(name)),
		});
		await expect(faceOf(page, "Study desk")).toBeVisible();

		await expect
			.poll(() => namesIn(ownRow(page)))
			.toEqual(sorted(LEFT_LISTENERS));
		await expect(rosterIn(playingOn(page))).toHaveCount(1);
		await expect(rosterIn(playerRowOf(page))).toHaveCount(0);
		await expect(rosterIn(rowLabelled(page, "Study desk"))).toHaveCount(0);
		for (const name of [PLAYER_LISTENER, ...LISTED_LISTENERS])
			await expect(playingOn(page).getByText(name)).toHaveCount(0);

		await untilQuiet(player);
		const reads = rosterReads(player).slice(from);
		expect(reads.length).toBeGreaterThan(0);
		expect(reads).toEqual(
			reads.map(() => ({ session: started.id, deviceId: DEVICE })),
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("a switch while listening draws the new session's roster in its row, read at once on the join, and never the one left's", async ({
		page,
		player,
	}) => {
		await page.clock.install();
		await watchRows(page, [{ row: JOINED_CREATOR, names: LEFT_LISTENERS }]);
		const { strict, refused, started } = await inStartedSession(page, player);
		withListeners(player, started.id, LEFT_LISTENERS);
		const target = startedElsewhere(player, JOINED_CREATOR, {
			listeners: [aDevice(JOINED_LISTENER)],
		});
		await expect(faceOf(page, JOINED_CREATOR)).toBeVisible();
		await expect
			.poll(() => namesIn(ownRow(page)))
			.toEqual(sorted(LEFT_LISTENERS));
		await untilQuiet(player);
		await pauseTheClock(page);
		const from = rosterReads(player).length;

		await faceOf(page, JOINED_CREATOR).click();

		await expect.poll(() => listensIn(target)).toBe(true);
		await expect
			.poll(() => namesIn(rowLabelled(page, JOINED_CREATOR)))
			.toEqual([JOINED_LISTENER]);
		await expect(
			currentRows(page).getByText(JOINED_CREATOR, { exact: true }),
		).toHaveCount(1);
		await expect(rosterIn(playingOn(page))).toHaveCount(1);
		expect(
			rosterReads(player)
				.slice(from)
				.filter((read) => read.session === target.id).length,
		).toBeGreaterThan(0);
		expect(await seenInRows(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("a read of the session left, answered after a switch, is never drawn and leaves the new session's roster standing", async ({
		page,
		player,
	}) => {
		await page.clock.install();
		await watchRows(page, [{ row: JOINED_CREATOR, names: LEFT_LISTENERS }]);
		const { strict, refused, started } = await inStartedSession(page, player);
		withListeners(player, started.id, LEFT_LISTENERS);
		startedElsewhere(player, JOINED_CREATOR, {
			listeners: [aDevice(JOINED_LISTENER)],
		});
		await expect(faceOf(page, JOINED_CREATOR)).toBeVisible();
		await expect
			.poll(() => namesIn(ownRow(page)))
			.toEqual(sorted(LEFT_LISTENERS));
		await untilQuiet(player);
		await pauseTheClock(page);

		const held: Route[] = [];
		await page.route(
			(url) =>
				url.pathname === "/api/stream/listeners" &&
				url.searchParams.get("session") === started.id,
			(route) => {
				held.push(route);
			},
		);
		for (
			let passed = 0;
			held.length === 0 && passed < OPEN_CADENCE_MS;
			passed += CLOCK_STEP_MS
		)
			await page.clock.runFor(CLOCK_STEP_MS);
		expect(held).toHaveLength(1);

		await faceOf(page, JOINED_CREATOR).click();
		await expect
			.poll(() => namesIn(rowLabelled(page, JOINED_CREATOR)))
			.toEqual([JOINED_LISTENER]);

		const answered = page.waitForEvent(
			"requestfinished",
			(request) => request === held[0].request(),
		);
		await held[0].continue();
		await answered;
		await untilQuiet(player);

		expect(await namesIn(rowLabelled(page, JOINED_CREATOR))).toEqual([
			JOINED_LISTENER,
		]);
		expect(await seenInRows(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("a join while listening to the player never draws the player's roster in the joined row", async ({
		page,
		player,
	}) => {
		await watchRows(page, [{ row: JOINED_CREATOR, names: [PLAYER_LISTENER] }]);
		const target = startedElsewhere(player, JOINED_CREATOR, {
			listeners: [aDevice(JOINED_LISTENER)],
		});
		const refused = await openOnThePlayer(page);
		await openPicker(page);
		await listenToThePlayer(page, player);
		await expect
			.poll(() => namesIn(playerRowOf(page)))
			.toEqual([PLAYER_LISTENER]);
		await expect(faceOf(page, JOINED_CREATOR)).toBeVisible();

		await faceOf(page, JOINED_CREATOR).click();

		await expect.poll(() => listensIn(target)).toBe(true);
		const strict = await strictOnceSettled(player);
		await expect
			.poll(() => namesIn(rowLabelled(page, JOINED_CREATOR)))
			.toEqual([JOINED_LISTENER]);
		await expect(rosterIn(playingOn(page))).toHaveCount(1);
		expect(await seenInRows(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("a device joining and then leaving the session reaches the roster within the open cadence while the picker is open", async ({
		page,
		player,
	}) => {
		await page.clock.install();
		const { strict, refused, started } = await inStartedSession(page, player);
		await pauseTheClock(page);
		const [first, second] = LEFT_LISTENERS;

		const firstConnection = player.addSessionListener(
			started.id,
			aDevice(first),
		);
		await advance(page, OPEN_CADENCE_MS);
		await expect.poll(() => namesIn(ownRow(page))).toEqual([first]);

		player.addSessionListener(started.id, aDevice(second));
		await advance(page, OPEN_CADENCE_MS);
		await expect
			.poll(() => namesIn(ownRow(page)))
			.toEqual(sorted([first, second]));

		firstConnection.close();
		await advance(page, OPEN_CADENCE_MS);
		await expect.poll(() => namesIn(ownRow(page))).toEqual([second]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("after Leave, the picker's roster is the player's, in the player's row, and the session left is never named there", async ({
		page,
		player,
	}) => {
		await watchRows(page, [{ row: PLAYER_NAME, names: LEFT_LISTENERS }]);
		const { strict, refused, started } = await inStartedSession(page, player);
		withListeners(player, started.id, LEFT_LISTENERS);
		await expect
			.poll(() => namesIn(ownRow(page)))
			.toEqual(sorted(LEFT_LISTENERS));
		await untilQuiet(player);

		strict.release();
		await leaveButton(page).click();

		await expect(thePlayersFace(page)).toBeVisible();
		await expect
			.poll(() => namesIn(playerRowOf(page)))
			.toEqual([PLAYER_LISTENER]);
		await untilQuiet(player);
		await expect(rosterIn(playingOn(page))).toHaveCount(1);
		for (const name of LEFT_LISTENERS)
			await expect(playingOn(page).getByText(name)).toHaveCount(0);
		expect(player.sessions.find(started.id)).toBe(started);
		expect(await seenInRows(page)).toEqual([]);
		expect(refused).toEqual([]);
	});
});

const CONTROL = "Control";
const CONTROLLING = "Controlling, not listening";
const LISTEN_HERE = "Listen here";
const LISTENING_HERE = "Listening here";
const ROSTER_WHILE_CONTROLLING = "Listening";

const controlNamed = (device: string) =>
	`Control what ${device} started, without listening`;

const playingWhat = (device: string) => `Playing what ${device} started`;

const endedToast = (device: string) =>
	`What ${device} started has ended, so Jean is back on ${PLAYER_NAME}.`;

const controlOf = (page: Page, device: string) =>
	playingOn(page).getByRole("button", {
		name: controlNamed(device),
		exact: true,
	});

const everyControl = (page: Page) =>
	playingOn(page).getByRole("button", { name: /\bcontrol/i });

const listenHereIn = (row: Locator) =>
	row.getByRole("button", { name: LISTEN_HERE, exact: true });

type PollScope = { session: string | null; deviceId: string | null };

const ON_THE_PLAYER: PollScope = { session: null, deviceId: null };

const pollScopesOf = (page: Page) => {
	const named: PollScope[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (request.method() === "GET" && url.pathname === "/api/state")
			named.push({
				session: url.searchParams.get("session"),
				deviceId: url.searchParams.get("deviceId"),
			});
	});
	return named;
};

const nextPolls = async (polls: PollScope[]) => {
	const from = polls.length;
	await expect.poll(() => polls.length).toBeGreaterThan(from + 1);
	return polls.slice(from);
};

const expectEachNames = (polls: PollScope[], scope: PollScope) =>
	expect(polls).toEqual(polls.map(() => scope));

const heardElsewhere = (
	player: FakePlayer,
	creator: string | SessionDevice,
	options: { plays?: Track; listeners?: SessionDevice[] } = {},
) =>
	startedElsewhere(player, creator, {
		listeners: [aDevice("Garage radio")],
		...options,
	});

const controlFromThePicker = async (
	page: Page,
	player: FakePlayer,
	device: string,
) => {
	await openPicker(page);
	await controlOf(page, device).click();
	await expect(opener(page)).toHaveAccessibleName(
		new RegExp(`^${playingWhat(device)}`),
	);
	await expect(
		rowLabelled(page, device).getByText(CONTROLLING, { exact: true }),
	).toBeVisible();
	return strictOnceSettled(player);
};

const recordToasts = (page: Page) =>
	page.addInitScript(() => {
		const raised: string[] = [];
		const seen = new WeakSet<Element>();
		Object.assign(window, { raisedToasts: raised });
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

const toastsRaised = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { raisedToasts: string[] }).raisedToasts,
	);

test.describe("Control, on a row another device started", () => {
	test.use(OFFERING_SESSIONS);

	const HEARD = "Kitchen tablet";
	const UNHEARD = "Attic radio";

	test(`stands after the face of a row read with listeners, showing "${CONTROL}" and named "${controlNamed(HEARD)}", and on no row read with none, nor on the player's row or the start row`, async ({
		page,
		player,
	}) => {
		heardElsewhere(player, HEARD);
		startedElsewhere(player, UNHEARD);
		await openOnThePlayer(page);
		await openPicker(page);
		await expect(rows(page)).toHaveCount(4);
		await expect(rowLabelled(page, UNHEARD)).toContainText(NOBODY_LISTENING);

		const control = controlOf(page, HEARD);
		await expect(control).toBeVisible();
		await expect(control).toHaveText(CONTROL);
		await expect(
			rowLabelled(page, HEARD).getByRole("button", {
				name: controlNamed(HEARD),
				exact: true,
			}),
		).toHaveCount(1);
		const label = rowLabelled(page, HEARD).getByText(HEARD, { exact: true });
		expect(
			await label.evaluate(
				(name, after) =>
					after !== null &&
					(name.compareDocumentPosition(after) &
						Node.DOCUMENT_POSITION_FOLLOWING) !==
						0,
				await control.elementHandle(),
			),
		).toBe(true);

		await untilQuiet(player);
		expect(await everyControl(page).count()).toBe(1);
		expect(
			await playingOn(page).getByText(CONTROL, { exact: true }).count(),
		).toBe(1);
		expect(await nestedControls(page)).toEqual([]);
	});
});

test.describe("pressing Control", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("opens no stream and takes no ticket, and from then each poll names the session and this device, and the page follows what it plays", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const [plays] = cast.elsewhere;
		const session = heardElsewhere(player, CREATOR, { plays });
		const refused = await openOnThePlayer(page);
		const stream = streamOf(page);
		const polls = pollScopesOf(page);
		await openPicker(page);
		await untilQuiet(player);

		await controlOf(page, CREATOR).click();

		await expect(opener(page)).toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
		await expect(statusBar(page)).toContainText(titleOf(plays));
		const strict = await strictOnceSettled(player);
		expectEachNames(await nextPolls(polls), {
			session: session.id,
			deviceId: DEVICE,
		});
		await untilQuiet(player);
		expect(stream).toEqual({ asked: 0, ended: 0 });
		expect(countPostsTo(player, "/api/stream/ticket")).toBe(0);
		expect(player.openStreams).toBe(0);
		expect(listensIn(session)).toBe(false);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: false,
		});
		strict.release();
		expect(refused).toEqual([]);
	});

	test("leaves the picker open with the row current, and on the desktop puts focus on its face", async ({
		page,
		player,
		isMobile,
	}) => {
		heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);

		const strict = await controlFromThePicker(page, player, CREATOR);

		await expect(playingOn(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(
			currentRows(page).getByText(CREATOR, { exact: true }),
		).toHaveCount(1);
		if (isMobile)
			await expect(
				page.getByRole("dialog", { name: "Playing on" }),
			).toBeVisible();
		else await expect(listenHereIn(rowLabelled(page, CREATOR))).toBeFocused();
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`on what ended between the list and the press, keeps the page on the player, says "${GONE_BEFORE_JOIN}" in the row, and raises no toast`, async ({
		page,
		player,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		await recordToasts(page);
		const refused = await openOnThePlayer(page);
		const polls = pollScopesOf(page);
		await openPicker(page);
		await expect(controlOf(page, CREATOR)).toBeVisible();
		await untilQuiet(player);
		player.endSession(session.id);

		await controlOf(page, CREATOR).click();

		const row = rowLabelled(page, CREATOR);
		await expect(
			row.getByText(GONE_BEFORE_JOIN, { exact: true }),
		).toBeVisible();
		await untilQuiet(player);
		await expect(row.getByRole("button")).toHaveCount(0);
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
		expect(await storedSession(page)).toBeNull();
		expectEachNames(await nextPolls(polls), ON_THE_PLAYER);
		expect(await toastsRaised(page)).toEqual([]);
		await expect(opener(page)).not.toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
		expect(refused).toEqual([]);
	});

	test("while this device listens to the player, asks after the session before it lets go of the player's stream and sends the player's leave, and opens nothing", async ({
		page,
		player,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const seen: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			const route = `${request.method()} ${url.pathname}`;
			const named = url.searchParams.get("session");
			const of = named === null ? "the player" : "it";
			if (route === "GET /api/state" && named === session.id)
				seen.push("poll it");
			if (route === "POST /api/stream/ticket") seen.push(`ticket ${of}`);
			if (route === "POST /api/stream/leave") seen.push(`leave ${of}`);
			if (route === "GET /api/stream") seen.push("stream opened");
		});
		const closed = (request: { method: () => string; url: () => string }) => {
			if (
				request.method() === "GET" &&
				new URL(request.url()).pathname === "/api/stream"
			)
				seen.push("stream closed");
		};
		page.on("requestfinished", closed);
		page.on("requestfailed", closed);
		await openPicker(page);
		await thePlayersFace(page).click();
		await expect(
			playerRowOf(page).getByText(LISTENING_HERE, { exact: true }),
		).toBeVisible();
		await expect.poll(() => player.openStreams).toBe(1);
		await expect.poll(() => player.streamDevices.has(DEVICE)).toBe(true);
		await untilQuiet(player);
		const from = seen.length;

		await controlOf(page, CREATOR).click();

		await expect(opener(page)).toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
		await expect.poll(() => player.openStreams).toBe(0);
		const strict = await strictOnceSettled(player);
		const after = seen.slice(from);
		expect(after[0]).toBe("poll it");
		expect(after).toContain("leave the player");
		expect(after).toContain("stream closed");
		expect(
			after.filter(
				(step) => step.startsWith("ticket") || step === "stream opened",
			),
		).toEqual([]);
		expect(player.streamDevices.has(DEVICE)).toBe(false);
		expect(listensIn(session)).toBe(false);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: false,
		});
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the row this tab only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test(`reads "${CONTROLLING}" with Leave on its listening line, its face is a button showing and named "${LISTEN_HERE}", and nothing reads "${LISTENING_HERE}"; the fader stays in the player's row`, async ({
		page,
		player,
	}) => {
		heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		const row = rowLabelled(page, CREATOR);

		const line = row.getByText(CONTROLLING, { exact: true });
		const leave = row.getByRole("button", { name: LEAVE_NAMED, exact: true });
		await expect(leave).toBeVisible();
		await expect(leave).toHaveText("Leave");
		const at = { line: await restingBox(line), leave: await restingBox(leave) };
		const middle = at.line.y + at.line.height / 2;
		expect(middle).toBeGreaterThan(at.leave.y);
		expect(middle).toBeLessThan(at.leave.y + at.leave.height);

		const face = listenHereIn(row);
		await expect(face).toBeVisible();
		await expect(face).toContainText(LISTEN_HERE);
		await expect(face).toContainText(CREATOR);
		await untilQuiet(player);
		expect(
			await playingOn(page)
				.getByRole("button", { name: LISTEN_HERE, exact: true })
				.count(),
		).toBe(1);
		expect(
			await playingOn(page).getByText(LISTENING_HERE, { exact: true }).count(),
		).toBe(0);
		expect(await row.getByRole("slider").count()).toBe(0);
		expect(await playerRowOf(page).getByRole("slider").count()).toBe(1);
		expect(await everyControl(page).count()).toBe(0);
		expect(await nestedControls(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`pressing its face takes one ticket naming the session, opens its stream, sends no leave and stays in it, and the line reads "${LISTENING_HERE}" with the face no button`, async ({
		page,
		player,
		isMobile,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const polls = pollScopesOf(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		const row = rowLabelled(page, CREATOR);
		const from = player.requests.length;

		await listenHereIn(row).click();

		await expect.poll(() => listensIn(session)).toBe(true);
		await expect(row.getByText(LISTENING_HERE, { exact: true })).toBeVisible();
		await untilQuiet(player);
		expect(ticketsAfter(player, from)).toEqual([
			{ session: session.id, deviceId: DEVICE, name: DEVICE_NAME },
		]);
		expect(
			stepsAfter(player, from, {}).filter((step) => step.startsWith("leave")),
		).toEqual([]);
		expect(await listenHereIn(row).count()).toBe(0);
		expect(await row.getByText(CONTROLLING, { exact: true }).count()).toBe(0);
		await expect(
			row.getByRole("button", { name: LEAVE_NAMED, exact: true }),
		).toBeVisible();
		if (!isMobile)
			await expect(
				row.getByRole("button", { name: LEAVE_NAMED, exact: true }),
			).toBeFocused();
		await expect(opener(page)).toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
		expectEachNames(await nextPolls(polls), {
			session: session.id,
			deviceId: DEVICE,
		});
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: true,
		});
		expect(player.sessions.find(session.id)).toBe(session);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("pressing its face with the ticket refused leaves the page controlling, its face still a button", async ({
		page,
		player,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const polls = pollScopesOf(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		const row = rowLabelled(page, CREATOR);
		const from = player.requests.length;
		player.fooJean.failTickets = 503;

		await listenHereIn(row).click();

		await expect
			.poll(() => ticketsAfter(player, from).map((ticket) => ticket.session))
			.toContain(session.id);
		await untilQuiet(player);
		await expect(row.getByText(CONTROLLING, { exact: true })).toBeVisible();
		await expect(listenHereIn(row)).toBeVisible();
		expect(
			await playingOn(page).getByText(LISTENING_HERE, { exact: true }).count(),
		).toBe(0);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: false,
		});
		expect(player.openStreams).toBe(0);
		expectEachNames(await nextPolls(polls), {
			session: session.id,
			deviceId: DEVICE,
		});
		player.fooJean.failTickets = null;
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("leaving what the page only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	const leavesSent = (player: FakePlayer, from: number) =>
		player.requests
			.slice(from)
			.filter(
				(entry) =>
					entry.method === "POST" &&
					entry.path.split("?")[0] === "/api/stream/leave",
			)
			.map((entry) => ({
				session: new URL(entry.path, "http://fake").searchParams.get("session"),
				deviceId: entry.body?.deviceId ?? null,
			}));

	test("Leave sends the leave naming the session and this device, opens no stream, and puts the page on the player, where the session goes on for the device listening to it", async ({
		page,
		player,
		isMobile,
	}) => {
		const creator = aDevice(CREATOR);
		const session = startedElsewhere(player, creator, { listeners: [creator] });
		await recordToasts(page);
		const refused = await openOnThePlayer(page);
		const stream = streamOf(page);
		const polls = pollScopesOf(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		await untilQuiet(player);
		const from = player.requests.length;

		strict.release();
		await leaveButton(page).click();

		await expect(thePlayersFace(page)).toBeVisible();
		if (!isMobile) await expect(thePlayersFace(page)).toBeFocused();
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		const leaves = leavesSent(player, from);
		expect(leaves.length).toBeGreaterThan(0);
		expect(leaves).toEqual(
			leaves.map(() => ({ session: session.id, deviceId: DEVICE })),
		);
		expect(stream).toEqual({ asked: 0, ended: 0 });
		expect(player.sessions.find(session.id)).toBe(session);
		expect(connectionsOf(session, creator.deviceId)).toBe(1);
		expect(await storedSession(page)).toBeNull();
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
		expectEachNames(await nextPolls(polls), ON_THE_PLAYER);
		expect(await toastsRaised(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("Leave ends the session where this device was the last left in it, and raises no toast", async ({
		page,
		player,
	}) => {
		const creator = aDevice(CREATOR);
		const listener = aDevice("Garage radio");
		const session = startedElsewhere(player, creator);
		const heard = player.addSessionListener(session.id, listener);
		await recordToasts(page);
		const refused = await openOnThePlayer(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		heard.close();
		player.sessions.leave(session, listener.deviceId);
		player.sessions.leave(session, creator.deviceId);
		expect(player.sessions.find(session.id)).toBe(session);
		await untilQuiet(player);

		strict.release();
		await leaveButton(page).click();

		await expect.poll(() => player.sessions.find(session.id)).toBeNull();
		await expect(thePlayersFace(page)).toBeVisible();
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		expect(await storedSession(page)).toBeNull();
		expect(await toastsRaised(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("with a second page of this browser listening to it, Leave ends nothing: that page's stream and poll go on", async ({
		page,
		player,
	}) => {
		const creator = aDevice(CREATOR);
		const session = startedElsewhere(player, creator);
		const refused = await openOnThePlayer(page);

		const beside = await page.context().newPage();
		await storeForThisTab(beside, { id: session.id, listening: true });
		const refusedBeside = refusalsFrom(beside);
		const besideStream = streamOf(beside);
		const besidePolls = pollScopesOf(beside);
		await beside.goto(ROUTE_WITH_NO_LIST);
		await openPicker(beside);
		await playingOn(beside)
			.getByRole("button", { name: "Start playing", exact: true })
			.click();
		await expect.poll(() => connectionsOf(session, DEVICE)).toBe(1);
		player.sessions.leave(session, creator.deviceId);
		expect(player.sessions.find(session.id)).toBe(session);

		const strict = await controlFromThePicker(page, player, CREATOR);
		const streamBefore = { ...besideStream };

		strict.release();
		await leaveButton(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect
			.poll(() => countPostsToSession(player, "/api/stream/leave", session.id))
			.toBeGreaterThan(0);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);

		expect(player.sessions.find(session.id)).toBe(session);
		expect(connectionsOf(session, DEVICE)).toBe(1);
		expect(besideStream).toEqual(streamBefore);
		expectEachNames(await nextPolls(besidePolls), {
			session: session.id,
			deviceId: DEVICE,
		});
		await expect(
			rowLabelled(beside, CREATOR).getByText(LISTENING_HERE, { exact: true }),
		).toBeVisible();
		expect(await storedSession(page)).toBeNull();
		expect(refused).toEqual([]);
		expect(refusedBeside).toEqual([]);
	});
});

test.describe("who listens, in the row this tab only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";
	const LISTENERS = ["Garage radio", "Porch tablet"];

	const rosterNamed = (row: Locator, heading: string) =>
		row.getByRole("list", { name: heading, exact: true });

	test(`is headed "${ROSTER_WHILE_CONTROLLING}" and lists the devices listening, none of them this one, and "${ALSO_LISTENING}" once the page listens too`, async ({
		page,
		player,
	}) => {
		const session = heardElsewhere(player, CREATOR, {
			listeners: LISTENERS.map(aDevice),
		});
		const refused = await openOnThePlayer(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		const row = rowLabelled(page, CREATOR);

		const roster = rosterNamed(row, ROSTER_WHILE_CONTROLLING);
		await expect(roster).toBeVisible();
		for (const name of LISTENERS)
			await expect(
				roster.getByRole("listitem").filter({ hasText: name }),
			).toHaveCount(1);
		await expect(roster.getByRole("listitem")).toHaveCount(LISTENERS.length);
		await expect(roster).not.toContainText(DEVICE_NAME);
		await untilQuiet(player);
		expect(
			await playingOn(page).getByText(ALSO_LISTENING, { exact: true }).count(),
		).toBe(0);

		await listenHereIn(row).click();
		await expect.poll(() => listensIn(session)).toBe(true);

		await expect(rosterNamed(row, ALSO_LISTENING)).toBeVisible();
		await untilQuiet(player);
		expect(await rosterNamed(row, ROSTER_WHILE_CONTROLLING).count()).toBe(0);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("a track the session this page only controls could not play", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";
	const skipped = (track: string) =>
		`Could not play “${track}”, so it was skipped.`;

	const titled = (player: FakePlayer, title: string) => {
		const track = player
			.playlistById("p7")
			?.items.find((held) => titleOf(held) === title);
		if (!track || player.libraryPathFor(track) === null)
			throw new Error(`the library holds no "${title}"`);
		return track;
	};

	const BEFORE_THE_PRESS = "The Future";
	const AFTER_THE_PRESS = "Deep, Deep";

	test("raises one toast for a report made after Control was pressed, and none for one already in it", async ({
		page,
		player,
		isMobile,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		player.addSessionReport(session.id, titled(player, BEFORE_THE_PRESS));
		await recordToasts(page);
		const refused = await openOnThePlayer(page);
		const polls = pollScopesOf(page);
		const strict = await controlFromThePicker(page, player, CREATOR);
		await closeThePicker(page, isMobile);
		await nextPolls(polls);
		await untilQuiet(player);
		expect(await toastsRaised(page)).toEqual([]);

		player.addSessionReport(session.id, titled(player, AFTER_THE_PRESS));

		await expect.poll(() => toastsRaised(page)).toHaveLength(1);
		await nextPolls(polls);
		await untilQuiet(player);
		expect(await toastsRaised(page)).toEqual([skipped(AFTER_THE_PRESS)]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("Control from the keyboard", () => {
	test.use(OFFERING_SESSIONS);
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const CREATOR = "Kitchen tablet";

	for (const key of ["Enter", "Space"])
		test(`${key} on Control controls, opens no stream, and leaves focus on the row's face`, async ({
			page,
			player,
		}) => {
			const session = heardElsewhere(player, CREATOR);
			const refused = await openOnThePlayer(page);
			await openPicker(page);
			await controlOf(page, CREATOR).focus();
			await untilQuiet(player);
			const from = player.requests.length;

			await page.keyboard.press(key);

			await expect(opener(page)).toHaveAccessibleName(
				new RegExp(`^${playingWhat(CREATOR)}`),
			);
			const strict = await strictOnceSettled(player);
			await expect(listenHereIn(rowLabelled(page, CREATOR))).toBeFocused();
			expect(ticketsAfter(player, from)).toEqual([]);
			expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
				id: session.id,
				listening: false,
			});
			strict.release();
			expect(refused).toEqual([]);
		});

	test("Right moves from a listed face to its Control and Left back, and neither presses anything", async ({
		page,
		player,
	}) => {
		heardElsewhere(player, CREATOR);
		await openOnThePlayer(page);
		await openPicker(page);
		await faceOf(page, CREATOR).focus();
		await expect(faceOf(page, CREATOR)).toBeFocused();
		await untilQuiet(player);
		const from = player.requests.length;

		await page.keyboard.press("ArrowRight");
		await expect(controlOf(page, CREATOR)).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(faceOf(page, CREATOR)).toBeFocused();

		await untilQuiet(player);
		expect(postsAfter(player, from)).toEqual([]);
		expect(await storedSession(page)).toBeNull();
	});
});

const BACKGROUND_CADENCE_MS = 20_000;

// A browser fires `visibilitychange` at the document and reports the state through
// `visibilityState` and `hidden`.
const showThePage = (page: Page, visible: boolean) =>
	page.evaluate((shown) => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => (shown ? "visible" : "hidden"),
		});
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => !shown,
		});
		document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
	}, visible);

const turnHidden = (page: Page) => showThePage(page, false);
const turnVisible = (page: Page) => showThePage(page, true);

test.describe("a hidden page that only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("keeps polling, naming the session and this device, at the background cadence", async ({
		page,
		player,
	}) => {
		const session = heardElsewhere(player, CREATOR);
		await storeForThisTab(page, { id: session.id, listening: false });
		await page.clock.install();
		const refused = refusalsFrom(page);
		const polls = pollScopesOf(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(playingWhat(CREATOR));
		const strict = await strictOnceSettled(player);
		await pauseTheClock(page);

		await turnHidden(page);
		const from = polls.length;
		await advance(page, 3 * BACKGROUND_CADENCE_MS + CLOCK_STEP_MS);
		await untilQuiet(player);

		const hidden = polls.slice(from);
		expect(hidden.length).toBeGreaterThanOrEqual(2);
		expect(hidden.length).toBeLessThanOrEqual(4);
		expectEachNames(hidden, { session: session.id, deviceId: DEVICE });
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: false,
		});
		strict.release();
		expect(refused).toEqual([]);
	});
});

// `foo_jean` cannot tell this page that the session goes on for the device that started it.
test.describe("a page that only controls a private session, when the other page of this browser stops listening to it", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test("is answered as though it ended: back on the player, with the ended toast once", async ({
		page,
		player,
	}) => {
		const creator = aDevice(CREATOR);
		const session = startedElsewhere(player, creator, { shared: false });
		session.join(DEVICE);
		await recordToasts(page);
		await storeForThisTab(page, { id: session.id, listening: false });
		const polls = pollScopesOf(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(playingWhat(CREATOR));

		const beside = await page.context().newPage();
		await storeForThisTab(beside, { id: session.id, listening: true });
		await beside.goto(ROUTE_WITH_NO_LIST);
		await openPicker(beside);
		await playingOn(beside)
			.getByRole("button", { name: "Start playing", exact: true })
			.click();
		await expect.poll(() => connectionsOf(session, DEVICE)).toBe(1);
		const strict = await strictOnceSettled(player);

		strict.release();
		await leaveButton(beside).click();

		await expect.poll(() => toastsRaised(page)).toHaveLength(1);
		expect(await toastsRaised(page)).toEqual([endedToast(CREATOR)]);
		expect(player.sessions.find(session.id)).toBe(session);
		expect(await storedSession(page)).toBeNull();
		expectEachNames(await nextPolls(polls), ON_THE_PLAYER);
		await untilQuiet(player);
		expect(await toastsRaised(page)).toEqual([endedToast(CREATOR)]);
	});
});

const NOBODY_NOW = `Nobody is listening any more. Jean goes back to ${PLAYER_NAME} unless somebody does.`;
const TAKEN_BACK = `Nobody was listening any more, so Jean is back on ${PLAYER_NAME}.`;

// `kMuteLingerSeconds` in `foo_jean`'s `core/settings.h`, eight seconds, plus one read at the open
// cadence, so a listener reconnecting inside the component's linger never takes the page out.
const NOBODY_LISTENING_MS = 8_000 + OPEN_CADENCE_MS;

const ONE_POLL_MS = 1_000;

const documentReadsOf = (player: FakePlayer, session: DetachedSession) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === `/api/sessions/${session.id}`,
	).length;

const anyDocumentReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0].startsWith("/api/sessions/"),
	).length;

const leavesOf = (player: FakePlayer, from = 0) =>
	player.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path.split("?")[0] === "/api/stream/leave",
		)
		.map((entry) => ({
			session: new URL(entry.path, "http://fake").searchParams.get("session"),
			deviceId: entry.body?.deviceId ?? null,
		}));

const pollsAndLeavesOf = (page: Page, session: DetachedSession) => {
	const sent: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.searchParams.get("session") !== session.id) return;
		const route = `${request.method()} ${url.pathname}`;
		if (route === "GET /api/state") sent.push("poll");
		if (route === "POST /api/stream/leave") sent.push("leave");
	});
	return sent;
};

// TanStack Query hands a cache write to the components observing it on a zero-delay timer, which
// only the page clock fires.
const advanceSettled = async (page: Page, player: FakePlayer, ms: number) => {
	for (let left = ms; left > 0; left -= OPEN_CADENCE_MS) {
		await advance(page, Math.min(left, OPEN_CADENCE_MS));
		await untilQuiet(player);
		await page.clock.runFor(1);
	}
};

const advanceUntil = async (
	page: Page,
	player: FakePlayer,
	done: () => boolean,
	ms: number,
) => {
	for (let passed = 0; passed < ms && !done(); passed += CLOCK_STEP_MS) {
		await page.clock.runFor(CLOCK_STEP_MS);
		if (passed % OPEN_CADENCE_MS === 0) await untilQuiet(player);
	}
	await untilQuiet(player);
	await page.clock.runFor(1);
};

const holdTheLeaves = async (page: Page) => {
	const held: Route[] = [];
	const isLeave = (url: URL) => url.pathname === "/api/stream/leave";
	await page.route(isLeave, (route) => {
		held.push(route);
	});
	return {
		async release() {
			for (const route of held.splice(0)) await route.continue();
			await page.unroute(isLeave);
		},
	};
};

const justAfterARead = async (
	page: Page,
	player: FakePlayer,
	session: DetachedSession,
) => {
	await untilQuiet(player);
	const before = documentReadsOf(player, session);
	for (
		let passed = 0;
		passed <= OPEN_CADENCE_MS && documentReadsOf(player, session) === before;
		passed += CLOCK_STEP_MS
	) {
		await page.clock.runFor(CLOCK_STEP_MS);
		await untilQuiet(player);
	}
	const after = documentReadsOf(player, session);
	expect(after, "no read at the open cadence came").toBeGreaterThan(before);
	return after;
};

const wordsBoxOf = (scope: Locator, phrase: string) =>
	scope.evaluate((element, said) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent?.includes(said)) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			const box = range.getBoundingClientRect();
			const first = range.getClientRects()[0];
			return { x: box.x, y: box.y, firstLineHeight: first?.height ?? 0 };
		}
		throw new Error(`no text reads "${said}"`);
	}, phrase);

const expectNeutralTone = async (page: Page, phrase: string) => {
	const toast = page
		.getByRole("status")
		.filter({ has: page.getByRole("button", { name: "Dismiss" }) })
		.filter({ hasText: phrase });
	await expect(toast).toHaveCount(1);
	const glyphs = toast.locator("svg");
	const drawn = await glyphs.evaluateAll((svgs) =>
		svgs.map((svg) => svg.getAttribute("class") ?? ""),
	);
	expect(
		drawn.filter((names) => drawing("triangle-alert").test(names)),
	).toEqual([]);
	expect(drawn.filter((names) => drawing("check").test(names))).toEqual([]);
	expect(drawn.filter((names) => drawing("info").test(names))).toHaveLength(1);
	const danger = await tokenColourIn(toast, "--danger");
	const colours = await glyphs.evaluateAll((svgs) =>
		svgs.map((svg) => getComputedStyle(svg).stroke),
	);
	expect(colours).not.toContain(danger);
};

test.describe("the document of what the page only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	// `foo_jean` does not move `sessionRevision` when a listener comes or goes, so a page following
	// the document off the poll alone never learns that nobody listens.
	test("is read at the roster's open cadence while the page only controls it, and once more on a poll that answers a change", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const [plays, next] = cast.elsewhere;
		const session = heardElsewhere(player, CREATOR);
		session.play([plays, next], 0);
		await storeForThisTab(page, { id: session.id, listening: false });
		await page.clock.install();
		const refused = refusalsFrom(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(playingWhat(CREATOR));
		const strict = await strictOnceSettled(player);
		await pauseTheClock(page);
		await advanceSettled(page, player, ONE_POLL_MS);
		await untilQuiet(player);
		const from = documentReadsOf(player, session);

		await advanceSettled(page, player, 5 * OPEN_CADENCE_MS);
		await untilQuiet(player);

		const read = documentReadsOf(player, session) - from;
		expect(read).toBeGreaterThanOrEqual(4);
		expect(read).toBeLessThanOrEqual(6);

		const atTheCadence = await justAfterARead(page, player, session);
		session.next();
		await advanceSettled(page, player, ONE_POLL_MS + 2 * CLOCK_STEP_MS);

		await expect(statusBar(page)).toContainText(titleOf(next));
		await expectSettlesAt(
			player,
			() => documentReadsOf(player, session),
			atTheCadence + 1,
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("on the player, no session's document is read however long the page stays", async ({
		page,
		player,
	}) => {
		heardElsewhere(player, CREATOR);
		await page.clock.install();
		const refused = await openOnThePlayer(page);
		await pauseTheClock(page);

		await advanceSettled(page, player, 5 * OPEN_CADENCE_MS);

		await expectSettlesAt(player, () => anyDocumentReads(player), 0);
		expect(refused).toEqual([]);
	});

	test(`while the page is in it to listen, with nobody listening, is read once on entering and never on a cadence, nothing says "${NOBODY_NOW}", and the page stays`, async ({
		page,
		player,
	}) => {
		const session = startedElsewhere(player, CREATOR);
		await recordToasts(page);
		await watchThePage(page, [NOBODY_NOW]);
		await storeForThisTab(page, { id: session.id, listening: true });
		await page.clock.install();
		const refused = refusalsFrom(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(playingWhat(CREATOR));
		const strict = await strictOnceSettled(player);
		await pauseTheClock(page);
		await openPicker(page);
		await expect(
			playingOn(page).getByRole("button", {
				name: "Start playing",
				exact: true,
			}),
		).toBeVisible();
		await untilQuiet(player);
		const from = documentReadsOf(player, session);

		await advanceSettled(
			page,
			player,
			NOBODY_LISTENING_MS + 2 * OPEN_CADENCE_MS,
		);

		await untilQuiet(player);
		expect(documentReadsOf(player, session)).toBe(from);
		expect(from).toBeLessThanOrEqual(1);
		expect((await watched(page)).shown).toEqual([]);
		expect(leavesOf(player)).toEqual([]);
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: true,
		});
		expect(await toastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("nobody listening any more, to what the page only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";
	const LISTENER = "Garage radio";

	const controlledOnThePageClock = async (
		page: Page,
		player: FakePlayer,
		watchedPhrases: string[] = [],
	) => {
		const [plays] = oneOffEachRecord(player).elsewhere;
		const session = startedElsewhere(player, CREATOR, { plays });
		const listener = aDevice(LISTENER);
		let held = player.addSessionListener(session.id, listener);
		const hearing = {
			close: () => held.close(),
			again: () => {
				held = player.addSessionListener(session.id, listener);
			},
		};
		await recordToasts(page);
		await watchThePage(page, watchedPhrases);
		await storeForThisTab(page, { id: session.id, listening: false });
		await page.clock.install();
		const refused = refusalsFrom(page);
		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(opener(page)).toHaveAccessibleName(playingWhat(CREATOR));
		const strict = await strictOnceSettled(player);
		await pauseTheClock(page);
		return { session, hearing, strict, refused };
	};

	const nobodyNowIn = (page: Page) =>
		rowLabelled(page, CREATOR).getByText(NOBODY_NOW, { exact: true });

	// Takes the only listener away and waits for the read that finds nobody: `foo_jean` reads the
	// session as paused from then, so the poll after it answers a change.
	const nobodyListensFromNow = async (
		page: Page,
		player: FakePlayer,
		session: DetachedSession,
		hearing: { close: () => void },
	) => {
		const before = documentReadsOf(player, session);
		hearing.close();
		await advanceSettled(page, player, ONE_POLL_MS);
		await expect
			.poll(() => documentReadsOf(player, session), {
				message:
					"no read of the document followed the poll after the listener went",
			})
			.toBeGreaterThan(before);
		await untilQuiet(player);
		await page.clock.runFor(1);
	};

	const stillControls = async (page: Page, session: DetachedSession) => {
		expect(JSON.parse((await storedSession(page)) ?? "null")).toEqual({
			id: session.id,
			listening: false,
		});
		await expect(opener(page)).toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
	};

	test(`from the first read finding nobody, the row this tab is in says "${NOBODY_NOW}" beside the warning glyph, and still offers listening, leaving and the transport`, async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player, [NOBODY_NOW]);
		await openPicker(page);
		const row = rowLabelled(page, CREATOR);
		await expect(row.getByText(CONTROLLING, { exact: true })).toBeVisible();
		await advanceSettled(page, player, 2 * OPEN_CADENCE_MS);
		await untilQuiet(player);
		expect((await watched(page)).shown).toEqual([]);

		hearing.close();
		await advanceSettled(page, player, ONE_POLL_MS);

		const line = nobodyNowIn(page);
		await expect(line).toBeVisible();
		await expect(playingOn(page).getByText(NOBODY_NOW)).toHaveCount(1);
		const glyph = row.locator("svg.lucide-triangle-alert");
		await expect(glyph).toHaveCount(1);
		const words = await wordsBoxOf(line, NOBODY_NOW);
		const at = await restingBox(glyph);
		expect(at.x + at.width).toBeLessThanOrEqual(words.x + 1);
		const middle = at.y + at.height / 2;
		expect(middle).toBeGreaterThan(words.y);
		expect(middle).toBeLessThan(words.y + words.firstLineHeight);

		await expect(listenHereIn(row)).toBeVisible();
		await expect(
			row.getByRole("button", { name: LEAVE_NAMED, exact: true }),
		).toBeVisible();
		const play = statusBar(page).getByRole("button", {
			name: "Play",
			exact: true,
		});
		await expect(play).toBeVisible();
		await expect(play).not.toHaveAttribute("aria-disabled", "true");
		await stillControls(page, session);
		strict.release();
		expect(refused).toEqual([]);
	});

	test(`once nobody has listened for longer than twelve seconds, leaves at a read: the leave names it, the page follows the player, and "${TAKEN_BACK}" is raised once in the neutral tone`, async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player);
		const sent = pollsAndLeavesOf(page, session);
		const polls = pollScopesOf(page);
		await openPicker(page);
		await nobodyListensFromNow(page, player, session, hearing);
		await expect(nobodyNowIn(page)).toBeVisible();

		await advanceSettled(page, player, NOBODY_LISTENING_MS - ONE_POLL_MS);
		await untilQuiet(player);
		expect(leavesOf(player)).toEqual([]);
		expect(await toastsRaised(page)).toEqual([]);
		await stillControls(page, session);

		const leaves = await holdTheLeaves(page);
		strict.release();
		await advanceUntil(
			page,
			player,
			() => sent.includes("leave"),
			OPEN_CADENCE_MS + 2 * ONE_POLL_MS,
		);
		expect(sent, "no leave was sent").toContain("leave");
		await advanceSettled(page, player, 2 * ONE_POLL_MS);
		await leaves.release();
		await untilQuiet(player);
		expect(sent.slice(sent.indexOf("leave"))).not.toContain("poll");

		await expect.poll(() => toastsRaised(page)).toHaveLength(1);
		expect(await toastsRaised(page)).toEqual([TAKEN_BACK]);
		await expectNeutralTone(page, TAKEN_BACK);
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
		expect(await storedSession(page)).toBeNull();
		const sentLeaves = leavesOf(player);
		expect(sentLeaves.length).toBeGreaterThan(0);
		expect(sentLeaves).toEqual(
			sentLeaves.map(() => ({ session: session.id, deviceId: DEVICE })),
		);

		const from = polls.length;
		await advanceSettled(page, player, PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		expectEachNames(polls.slice(from), ON_THE_PLAYER);
		expect(polls.length).toBeGreaterThan(from);
		expect(await toastsRaised(page)).toEqual([TAKEN_BACK]);
		expect(player.sessions.find(session.id)).toBe(session);

		await page.reload();
		await expect(opener(page)).not.toHaveAccessibleName(
			new RegExp(`^${playingWhat(CREATOR)}`),
		);
		await advanceSettled(page, player, 3 * ONE_POLL_MS);
		await untilQuiet(player);
		expect(await toastsRaised(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("a listener gone and back inside the window changes nothing, and the window starts afresh at the next time nobody listens", async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player);
		await openPicker(page);
		await nobodyListensFromNow(page, player, session, hearing);
		await expect(nobodyNowIn(page)).toBeVisible();

		await advanceSettled(page, player, OPEN_CADENCE_MS);
		hearing.again();
		await advanceSettled(page, player, ONE_POLL_MS);
		await expect(nobodyNowIn(page)).toHaveCount(0);
		await expect(
			rowLabelled(page, CREATOR).getByText(CONTROLLING, { exact: true }),
		).toBeVisible();

		await advanceSettled(page, player, NOBODY_LISTENING_MS + OPEN_CADENCE_MS);
		await untilQuiet(player);
		expect(await nobodyNowIn(page).count()).toBe(0);
		expect(leavesOf(player)).toEqual([]);
		expect(await toastsRaised(page)).toEqual([]);
		await stillControls(page, session);

		await nobodyListensFromNow(page, player, session, hearing);
		await expect(nobodyNowIn(page)).toBeVisible();
		await advanceSettled(page, player, NOBODY_LISTENING_MS - ONE_POLL_MS);
		await untilQuiet(player);
		expect(leavesOf(player)).toEqual([]);
		expect(await toastsRaised(page)).toEqual([]);
		await stillControls(page, session);

		strict.release();
		await advanceSettled(page, player, OPEN_CADENCE_MS + 2 * ONE_POLL_MS);
		await expect.poll(() => toastsRaised(page)).toEqual([TAKEN_BACK]);
		expect(await storedSession(page)).toBeNull();
		expect(refused).toEqual([]);
	});

	test("a press of play inside the window sends play-pause naming the session and this device, and takes no ticket and no leave", async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player);
		await nobodyListensFromNow(page, player, session, hearing);
		const play = statusBar(page).getByRole("button", {
			name: "Play",
			exact: true,
		});
		await expect(play).toBeVisible();
		const from = player.requests.length;

		await play.click();

		await expect.poll(() => playbackCommands(player).length).toBeGreaterThan(0);
		await advanceSettled(page, player, 2 * ONE_POLL_MS);
		await untilQuiet(player);
		const sentNow = player.requests
			.slice(from)
			.filter(
				(entry) =>
					entry.method === "POST" && entry.path.startsWith("/api/playback/"),
			)
			.map((entry) => {
				const url = new URL(entry.path, "http://fake");
				return {
					route: url.pathname,
					session: url.searchParams.get("session"),
					deviceId: url.searchParams.get("deviceId"),
				};
			});
		expect(sentNow).toEqual([
			{
				route: "/api/playback/play-pause",
				session: session.id,
				deviceId: DEVICE,
			},
		]);
		expect(countPostsTo(player, "/api/stream/ticket")).toBe(0);
		expect(leavesOf(player)).toEqual([]);
		await stillControls(page, session);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("stays past the window while the document cannot be read, and leaves once reads land again and still find nobody", async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player);
		await nobodyListensFromNow(page, player, session, hearing);
		const theDocument = (url: URL) =>
			url.pathname === `/api/sessions/${session.id}`;
		await page.route(theDocument, (route) => route.abort());

		await advanceSettled(
			page,
			player,
			NOBODY_LISTENING_MS + 2 * OPEN_CADENCE_MS,
		);

		await untilQuiet(player);
		expect(leavesOf(player)).toEqual([]);
		expect(await toastsRaised(page)).toEqual([]);
		await stillControls(page, session);

		strict.release();
		await page.unroute(theDocument);
		await advance(
			page,
			NOBODY_LISTENING_MS + OPEN_CADENCE_MS + 2 * ONE_POLL_MS,
		);
		await expect.poll(() => toastsRaised(page)).toEqual([TAKEN_BACK]);
		expect(leavesOf(player).length).toBeGreaterThan(0);
		expect(await storedSession(page)).toBeNull();
		expect(refused).toEqual([]);
	});

	test(`a page hidden through the window has left by a window after it is shown again, raising "${TAKEN_BACK}" once`, async ({
		page,
		player,
	}) => {
		const { session, hearing, strict, refused } =
			await controlledOnThePageClock(page, player);
		await openPicker(page);
		await nobodyListensFromNow(page, player, session, hearing);
		await expect(nobodyNowIn(page)).toBeVisible();

		strict.release();
		await turnHidden(page);
		await advanceSettled(page, player, 3 * BACKGROUND_CADENCE_MS);
		await turnVisible(page);
		await advance(
			page,
			NOBODY_LISTENING_MS + OPEN_CADENCE_MS + 2 * ONE_POLL_MS,
		);

		await expect.poll(() => toastsRaised(page)).toEqual([TAKEN_BACK]);
		expect(await storedSession(page)).toBeNull();
		const leaves = leavesOf(player);
		expect(leaves.length).toBeGreaterThan(0);
		expect(leaves).toEqual(
			leaves.map(() => ({ session: session.id, deviceId: DEVICE })),
		);
		expect(refused).toEqual([]);
	});
});

test.describe("a page that only controls what nobody else is in, when the other page of this browser stops listening to it", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	test(`raises the ended toast once and never "${TAKEN_BACK}"`, async ({
		page,
		player,
	}) => {
		const creator = aDevice(CREATOR);
		const session = startedElsewhere(player, creator);
		await recordToasts(page);
		const refused = await openOnThePlayer(page);

		const beside = await page.context().newPage();
		await storeForThisTab(beside, { id: session.id, listening: true });
		await beside.goto(ROUTE_WITH_NO_LIST);
		await openPicker(beside);
		await playingOn(beside)
			.getByRole("button", { name: "Start playing", exact: true })
			.click();
		await expect.poll(() => connectionsOf(session, DEVICE)).toBe(1);
		player.sessions.leave(session, creator.deviceId);
		expect(player.sessions.find(session.id)).toBe(session);

		const strict = await controlFromThePicker(page, player, CREATOR);
		const polls = pollScopesOf(page);

		const leaves = await holdTheLeaves(beside);
		strict.release();
		await leaveButton(beside).click();
		await expect(
			rowLabelled(page, CREATOR).getByText(NOBODY_NOW, { exact: true }),
		).toBeVisible();
		await leaves.release();

		await expect.poll(() => player.sessions.find(session.id)).toBeNull();
		await expect.poll(() => toastsRaised(page)).toHaveLength(1);
		expect(await toastsRaised(page)).toEqual([endedToast(CREATOR)]);
		expect(await storedSession(page)).toBeNull();
		expectEachNames(await nextPolls(polls), ON_THE_PLAYER);
		await page.waitForTimeout(PAST_THE_SECOND_LEAVE_MS);
		await untilQuiet(player);
		expect(await toastsRaised(page)).toEqual([endedToast(CREATOR)]);
		expect(refused).toEqual([]);
	});
});

const volumeFadersIn = (scope: Locator) =>
	scope.getByRole("slider", { name: /^Volume\b/ });

const levelControlsIn = (scope: Locator) =>
	scope.getByRole("button", {
		name: /^(Mute|Unmute|Show volume|Hide volume)\b/,
	});

const thePlayersFader = (page: Page) =>
	playerRowOf(page).getByRole("slider", {
		name: new RegExp(`^Volume on ${PLAYER_NAME}\\b`),
	});

const moveFader = async (
	page: Page,
	isMobile: boolean,
	fader: Locator,
	fraction: number,
) => {
	await expect(fader).toBeVisible();
	if (!isMobile) return dragTo(page, fader, fraction);
	const box = await restingBox(fader);
	const vertical = box.height > box.width;
	await fader.tap({
		position: vertical
			? { x: box.width / 2, y: box.height * (1 - fraction) }
			: { x: box.width * fraction, y: box.height / 2 },
	});
};

const volumesSent = (player: FakePlayer, from = 0) =>
	player.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method === "POST" && entry.path.split("?")[0] === "/api/volume",
		)
		.map((entry) =>
			new URL(entry.path, "http://fake").searchParams.get("session"),
		);

const statusBarFaders = async (page: Page, isMobile: boolean) => {
	const bar = statusBar(page);
	if (isMobile) await bar.getByRole("button", { name: "Show volume" }).click();
	return volumeFadersIn(bar);
};

const expectNoFaderIn = async (page: Page, player: FakePlayer) => {
	await untilQuiet(player);
	const bar = statusBar(page);
	expect(await volumeFadersIn(bar).count()).toBe(0);
	expect(await levelControlsIn(bar).count()).toBe(0);
};

test.describe("the status bar's fader while the page only controls", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";

	// `foo_jean`'s `POST /api/volume` names no session and moves the player, so a fader there would
	// move the player while the page shows the session.
	test("is not drawn; the player's row in the picker still moves the player, naming no session; listening brings this device's fader back", async ({
		page,
		player,
		isMobile,
	}) => {
		heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		const onThePlayer = await statusBarFaders(page, isMobile);
		await expect(onThePlayer).toHaveCount(1);
		await expect(onThePlayer).toHaveAccessibleName("Volume");
		if (isMobile)
			await statusBar(page)
				.getByRole("button", { name: "Hide volume" })
				.click();

		const strict = await controlFromThePicker(page, player, CREATOR);
		await closeThePicker(page, isMobile);

		await expectNoFaderIn(page, player);

		await openPicker(page);
		const level = player.player.volume.value;
		const from = player.requests.length;
		await moveFader(page, isMobile, thePlayersFader(page), 0.3);
		await expect
			.poll(() => volumesSent(player, from).length)
			.toBeGreaterThan(0);
		await untilQuiet(player);
		expect(volumesSent(player, from)).toEqual(
			volumesSent(player, from).map(() => null),
		);
		expect(player.player.volume.value).not.toBe(level);

		await listenHereIn(rowLabelled(page, CREATOR)).click();
		await expect(
			rowLabelled(page, CREATOR).getByText(LISTENING_HERE, { exact: true }),
		).toBeVisible();
		await closeThePicker(page, isMobile);
		const here = await statusBarFaders(page, isMobile);
		await expect(here).toHaveCount(1);
		await expect(here).toHaveAccessibleName("Volume on this device");
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the status bar's fader while the page only controls, with playback control off", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { ...OFFERING_SESSIONS.fooJean, canControlPlayback: false },
	});

	const CREATOR = "Kitchen tablet";

	test("is not drawn, and the player's row's fader is disabled with the reason, as on the player", async ({
		page,
		player,
		isMobile,
	}) => {
		heardElsewhere(player, CREATOR);
		const refused = await openOnThePlayer(page);
		await expect(levelControlsIn(statusBar(page)).first()).toBeVisible();

		const strict = await controlFromThePicker(page, player, CREATOR);
		await expectDisabledWithReason(thePlayersFader(page));
		await closeThePicker(page, isMobile);

		await expectNoFaderIn(page, player);
		expect(volumesSent(player)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the status bar's fader while the page is in what it started and hears nothing", () => {
	test.use(OFFERING_SESSIONS);

	const KEEPS_DROPPING =
		"The stream keeps dropping. Check that foobar2000 is running.";

	test(`once the stream has dropped for good and the row says "${KEEPS_DROPPING}", is not drawn and the volume keys send nothing; the player's row keeps the player's fader`, async ({
		page,
		player,
		isMobile,
	}) => {
		test.setTimeout(90_000);
		const { strict, refused, started } = await inStartedSession(page, player);
		started.play([oneOffEachRecord(player).atThePlayer], 0);
		player.addSessionListener(started.id, aDevice("Garage radio"));
		await page.route(
			(url) => url.pathname === "/api/stream/ticket",
			(route) => route.abort(),
		);
		started.hangUp();

		await expect(
			ownRow(page).getByText(KEEPS_DROPPING, { exact: true }),
		).toBeVisible({ timeout: 60_000 });
		await expect(thePlayersFader(page)).toBeVisible();
		await closeThePicker(page, isMobile);

		await expectNoFaderIn(page, player);
		if (!isMobile) {
			await page.evaluate(() =>
				(document.activeElement as HTMLElement | null)?.blur(),
			);
			for (const key of ["=", "-", "="]) await page.keyboard.press(key);
			await expectSettlesAt(player, () => volumesSent(player), []);
		}
		strict.release();
		expect(refused).toEqual([]);
	});

	test("loaded again into it, before Start playing is pressed, draws only this device's fader, which sends the player nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);

		await page.reload();
		await openPicker(page);
		await expect(
			playingOn(page).getByRole("button", {
				name: "Start playing",
				exact: true,
			}),
		).toBeVisible();
		await closeThePicker(page, isMobile);
		await untilQuiet(player);
		const from = player.requests.length;

		const faders = await statusBarFaders(page, isMobile);
		await expect(faders).toHaveCount(1);
		await expect(faders).toHaveAccessibleName("Volume on this device");
		await moveFader(page, isMobile, faders, 0.2);

		await expectSettlesAt(player, () => volumesSent(player, from), []);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const JOIN_REFUSED = `${PLAYER_NAME} could not start the stream.`;
const BUSY = en["listen.busy"];

// The words `foo_jean` answers a refused ticket with.
const STREAMING_OFF = "streaming is not available";
const CAP = "too many listeners";

const refuseTicketsUntilLifted = async (
	page: Page,
	session: DetachedSession,
	error: string,
) => {
	let refusing = true;
	await page.route(
		(url) =>
			url.pathname === "/api/stream/ticket" &&
			url.searchParams.get("session") === session.id,
		(route) =>
			refusing
				? route.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error }),
					})
				: route.fallback(),
	);
	return {
		lift() {
			refusing = false;
		},
	};
};

const expectReadsRefused = async (
	page: Page,
	device: string,
	plays: Track,
	error: string,
) => {
	const row = rowLabelled(page, device);
	await expect(row.getByText(JOIN_REFUSED, { exact: true })).toBeVisible();
	await expect(row).not.toContainText(titleOf(plays));
	await expect(row).not.toContainText(NOBODY_LISTENING);
	await expect(faceOf(page, device)).toBeVisible();
	await expect(faceOf(page, device)).toBeEnabled();
	await expect(row.getByText(GONE_BEFORE_JOIN)).toHaveCount(0);
	await expect(playingOn(page).getByText(JOIN_REFUSED)).toHaveCount(1);
	await expect(playingOn(page).getByText(BUSY)).toHaveCount(0);
	await expect(playingOn(page).getByText(error)).toHaveCount(0);
};

test.describe("a join refused by a 503 ticket", () => {
	test.use(OFFERING_SESSIONS);

	const CREATOR = "Kitchen tablet";
	const BESIDE = "Attic radio";

	test("from what the page started, a ticket refused with 'streaming is not available' draws the refusal in the pressed row in place of its second line, its face still a button, with no toast and the page listening where it was", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		await recordToasts(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		const target = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		const order = [PLAYER_NAME, DEVICE_NAME, CREATOR, START];
		await expectRowsInOrder(page, order);
		await untilQuiet(player);
		await refuseTicketsUntilLifted(page, target, STREAMING_OFF);

		await faceOf(page, CREATOR).click();

		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], STREAMING_OFF);
		await untilQuiet(player);
		await expectRowsInOrder(page, order);
		await expect(
			currentRows(page).getByText(DEVICE_NAME, { exact: true }),
		).toHaveCount(1);
		expect(connectionsOf(started, DEVICE)).toBe(1);
		expect(listensIn(target)).toBe(false);
		expect(await toastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("from the player, not listening, a ticket refused with a cap-shaped error draws the same refusal in the pressed row in place of its second line, its face still a button, with no toast and the page on the player", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const target = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		await recordToasts(page);
		const refused = await openOnThePlayer(page);
		await openPicker(page);
		const order = [PLAYER_NAME, CREATOR, START];
		await expectRowsInOrder(page, order);
		await untilQuiet(player);
		await refuseTicketsUntilLifted(page, target, CAP);

		await faceOf(page, CREATOR).click();

		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], CAP);
		await untilQuiet(player);
		await expectRowsInOrder(page, order);
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
		await expect(thePlayersFace(page)).toBeVisible();
		expect(await storedSession(page)).toBeNull();
		expect(listensIn(target)).toBe(false);
		expect(await toastsRaised(page)).toEqual([]);
		expect(refused).toEqual([]);
	});

	test("the refusal stands through a read of the list while the picker is open, and is gone once it closes and opens again", async ({
		page,
		player,
		isMobile,
	}) => {
		const cast = oneOffEachRecord(player);
		const target = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		const refused = await openOnThePlayer(page);
		await openPicker(page);
		await expect(faceOf(page, CREATOR)).toBeVisible();
		await untilQuiet(player);
		await refuseTicketsUntilLifted(page, target, STREAMING_OFF);

		await faceOf(page, CREATOR).click();
		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], STREAMING_OFF);
		const readsFrom = sessionReads(player).length;
		await expect
			.poll(() => sessionReads(player).length)
			.toBeGreaterThan(readsFrom);
		await untilQuiet(player);
		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], STREAMING_OFF);

		await closeThePicker(page, isMobile);
		await openPicker(page);

		const row = rowLabelled(page, CREATOR);
		await expect(row).toContainText(titleOf(cast.elsewhere[0]));
		await expect(
			row.getByText(NOBODY_LISTENING, { exact: true }),
		).toBeVisible();
		await expect(playingOn(page).getByText(JOIN_REFUSED)).toHaveCount(0);
		await expect(faceOf(page, CREATOR)).toBeVisible();
		expect(refused).toEqual([]);
	});

	test("a later press on the row that the player takes joins it, and the refusal is gone from the row then and after the page leaves it", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const { strict, refused, started } = await inStartedSession(page, player);
		const target = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		await expect(faceOf(page, CREATOR)).toBeVisible();
		await untilQuiet(player);
		const refusal = await refuseTicketsUntilLifted(page, target, CAP);
		await faceOf(page, CREATOR).click();
		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], CAP);
		await untilQuiet(player);

		refusal.lift();
		await faceOf(page, CREATOR).click();

		await expect.poll(() => listensIn(target)).toBe(true);
		await expect.poll(() => player.sessions.find(started.id)).toBeNull();
		await expect(
			currentRows(page).getByText(CREATOR, { exact: true }),
		).toHaveCount(1);
		await expect(leaveButton(page)).toBeVisible();
		await expect(playingOn(page).getByText(JOIN_REFUSED)).toHaveCount(0);
		strict.release();

		await leaveButton(page).click();
		await expect(
			currentRows(page).getByText(PLAYER_NAME, { exact: true }),
		).toHaveCount(1);
		await expect(faceOf(page, CREATOR)).toBeVisible();
		await expect(
			rowLabelled(page, CREATOR).getByText(titleOf(cast.elsewhere[0])),
		).toBeVisible();
		await expect(playingOn(page).getByText(JOIN_REFUSED)).toHaveCount(0);
		expect(refused).toEqual([]);
	});

	test("the refusal stands in the pressed row only: the row beside it keeps what it plays and who listens, and its face", async ({
		page,
		player,
	}) => {
		const cast = oneOffEachRecord(player);
		const { strict, refused } = await inStartedSession(page, player);
		const target = startedElsewhere(player, CREATOR, {
			plays: cast.elsewhere[0],
		});
		startedElsewhere(player, BESIDE, {
			plays: cast.elsewhere[1],
			listeners: [aDevice("Porch speaker")],
		});
		await expectRowsInOrder(page, [
			PLAYER_NAME,
			DEVICE_NAME,
			CREATOR,
			BESIDE,
			START,
		]);
		await untilQuiet(player);
		await refuseTicketsUntilLifted(page, target, STREAMING_OFF);

		await faceOf(page, CREATOR).click();

		await expectReadsRefused(page, CREATOR, cast.elsewhere[0], STREAMING_OFF);
		const beside = rowLabelled(page, BESIDE);
		await expect(beside).toContainText(titleOf(cast.elsewhere[1]));
		await expect(beside).toContainText(artistOf(cast.elsewhere[1]));
		await expect(
			beside.getByText("1 listening", { exact: true }),
		).toBeVisible();
		await expect(beside.getByText(JOIN_REFUSED)).toHaveCount(0);
		await expect(faceOf(page, BESIDE)).toBeVisible();
		strict.release();
		expect(refused).toEqual([]);
	});
});
