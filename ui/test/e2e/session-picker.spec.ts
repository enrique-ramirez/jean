import { PROBE_TIMEOUT_MS } from "../../src/shared/api/client.ts";
import type { DetachedSession } from "../fake-api/sessions.ts";
import {
	countPostsToSession,
	drawing,
	expect,
	expectSettlesAt,
	type FakePlayer,
	fieldOf,
	type Locator,
	type Page,
	pickerOpener,
	playingOn,
	statusBar,
	test,
	titleOf,
	tokenColourIn,
	untilQuiet,
	untilTheInstallIsKnown,
} from "./fixtures.ts";
import { dragTo } from "./gestures.ts";
import {
	ANOTHER_DEVICE,
	castOf,
	closePicker,
	currentRows,
	DEVICE,
	DEVICE_NAME,
	expectStillOpen,
	expectThePlayerUntouched,
	heldAtThePlayer,
	inStartedSession,
	inThe,
	KITCHEN,
	LEAVE_NAMED,
	LISTENING_HERE,
	leaveButton,
	listensIn,
	morePolls,
	OFFERING_SESSIONS,
	ON_THE_PLAYER,
	openOnThePlayer,
	openPicker,
	ownRow,
	PLAYER_NAME,
	pickerRows,
	playerRowOf,
	ROUTE_WITH_NO_LIST,
	recordEveryToast,
	refusalsFrom,
	START,
	STARTED_HERE,
	scopeIn,
	sessionPlays,
	setTheScene,
	startButton,
	startedBy,
	startHere,
	statePolls,
	statePollsSentBy,
	storedForThisTab,
	storeForThisTab,
	strictOnceSettled,
	THIS_DEVICE,
	thePlayersFace,
	toastSaying,
	toastsRaised,
	WELL_AFTER_LEAVING_MS,
	watchTheToasts,
} from "./sessions.ts";

const START_DETAIL = `${PLAYER_NAME} carries on as it is.`;

const ONLY_LISTENER = "Only this device is listening, so leaving ends it.";

const ON_THE_PLAYER_NAME = "Choose where to play";

const waysOut = (scope: Locator) =>
	scope.getByRole("button", {
		name: /^(Leave\b|Stop\b|Stop listening here)/,
	});

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
		if (route === "GET /api/stream") seen.push("stream");
	});
	return seen;
};

test.describe("the start row, where sessions are offered", () => {
	test.use(OFFERING_SESSIONS);

	test(`is the picker's last row, a button reading "${START}" over "${START_DETAIL}", with the player's row still first`, async ({
		page,
		player,
	}) => {
		await openOnThePlayer(page);
		await openPicker(page);

		await expect(pickerRows(page)).toHaveCount(2);
		await expect(
			pickerRows(page).first().getByText(PLAYER_NAME, { exact: true }),
		).toBeVisible();
		await expect(
			pickerRows(page).last().getByRole("button"),
		).toHaveAccessibleName(START);
		await expect(pickerRows(page).last()).toContainText(START_DETAIL);
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
		await expect(pickerRows(page)).toHaveCount(1);
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

		await expect(pickerOpener(page)).toHaveCount(0);
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
		expect(order.slice(0, 3)).toEqual(["created", "ticket", "stream"]);
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

		await expect(pickerRows(page)).toHaveCount(3);
		await expect(pickerRows(page).nth(1)).toContainText(DEVICE_NAME);
		await expect(pickerRows(page).nth(1)).toContainText(THIS_DEVICE);
		await expect(ownRow(page)).toContainText(DEVICE_NAME);
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText(THIS_DEVICE);
		await expect(
			pickerRows(page).last().getByRole("button"),
		).toHaveAccessibleName(START);
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
			fieldOf(cast.inTheSession, "%artist%"),
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
			pickerRows(page).first().getByText(PLAYER_NAME, { exact: true }),
		).toBeVisible();
		await expect(playingOn(page).getByText("Listen here")).toHaveCount(0);
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).not.toContainText(PLAYER_NAME, {
			useInnerText: true,
		});
		await expect(startButton(page)).toBeVisible();
		await expect(
			pickerRows(page).last().getByRole("button"),
		).toHaveAccessibleName(START);
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
		await expect(pickerOpener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);

		await startHere(page, player);
		const strict = await strictOnceSettled(player);
		await expect(pickerOpener(page)).toHaveAccessibleName(STARTED_HERE);

		strict.release();
		await leaveButton(page).click();
		await expect.poll(() => player.sessions.list()).toEqual([]);
		await expect(pickerOpener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
		expect(refused).toEqual([]);
	});
});

test.describe("leaving what this device started", () => {
	test.use(OFFERING_SESSIONS);

	test("Leave ends what it started, and every leave names it", async ({
		page,
		player,
	}) => {
		const { strict, started } = await inStartedSession(page, player);

		strict.release();
		await leaveButton(page).click();

		await expectSettlesAt(player, () => player.sessions.find(started.id), null);
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
		await expect(pickerRows(page)).toHaveCount(2);
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
		await expect(pickerOpener(page)).toBeVisible();
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
		await expect(pickerOpener(second)).toHaveAccessibleName(ON_THE_PLAYER_NAME);

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
		await page.waitForTimeout(WELL_AFTER_LEAVING_MS);
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
		await page.waitForTimeout(WELL_AFTER_LEAVING_MS);
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
		await page.waitForTimeout(WELL_AFTER_LEAVING_MS);
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
		await pickerOpener(page).focus();
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
		await expect(pickerOpener(page)).toBeFocused();
		expect(refused).toEqual([]);
	});

	test("in what it started, Enter on the opener focuses Leave, Tab goes on to the start row, and Shift+Tab from Leave reaches the player's row", async ({
		page,
		player,
	}) => {
		const { strict, refused } = await inStartedSession(page, player);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();

		await pickerOpener(page).focus();
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

const ENDED_KITCHEN = `What ${KITCHEN} started has ended, so Jean is back on ${PLAYER_NAME}.`;

const ONE_PLACE_TAKEN = {
	...OFFERING_SESSIONS,
	fooJean: { maxSessions: 1, canCreateSessions: true },
};

const takeTheOnePlace = (player: FakePlayer) =>
	player.sessions.create({ deviceId: ANOTHER_DEVICE.deviceId, name: null });

const startRowItem = (page: Page) =>
	pickerRows(page).filter({
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
		await expect(pickerRows(page)).toHaveCount(2);
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
		player.fooJean.hangCapabilities = true;
		player.fooJean.canCreateSessions = false;

		expect(await pressStart(page)).toEqual(NOT_AVAILABLE);
		player.fooJean.canCreateSessions = true;

		await expect(startButton(page)).toHaveCount(0, {
			timeout: PROBE_TIMEOUT_MS / 2,
		});
		await expect(playingOn(page)).toBeVisible();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect(pickerRows(page)).toHaveCount(1);
		await expect(playingOn(page).getByText(START_DETAIL)).toHaveCount(0);
		expect(await storedForThisTab(page)).toBeNull();
		expect(statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
		expect(postsTo(player, "/api/stream/ticket")).toEqual([]);
		expect(streamsOpened(player)).toBe(0);

		player.fooJean.configGeneration += 1;
		player.fooJean.hangCapabilities = false;

		await expect(startButton(page)).toBeVisible();
		await expect(pickerRows(page)).toHaveCount(2);
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
		await pickerOpener(page).focus();
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

const endedToastsRaised = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { everyToast: string[] }).everyToast.filter((said) =>
			/has ended, so Jean is back on/.test(said),
		),
	);

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
	await expect(pickerOpener(page)).toHaveAccessibleName(
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
		await expect(pickerOpener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
		await page.waitForTimeout(WELL_AFTER_LEAVING_MS);
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
		await expect(pickerOpener(page)).toHaveAccessibleName(ON_THE_PLAYER_NAME);
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
