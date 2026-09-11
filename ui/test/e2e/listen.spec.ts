import {
	dragTo,
	expect,
	expectSettlesAt,
	type FakePlayer,
	FOO_JEAN_TOKEN,
	type Locator,
	nowPlayingScreen,
	openNowPlaying,
	type Page,
	requestsTo,
	statusBar,
	test,
} from "./fixtures.ts";

// Playwright cannot hear anything, so nothing here asserts on sound -- only on
// what went over the wire and what the audio element believes.

const TICK = [100, 100, 200];

const listenButton = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

const thisDevice = (page: Page) =>
	page.getByRole("button", { name: /^(Listen here|Stop listening here)$/ });

// The element is created by the store and never mounted in the tree.
const currentTime = (page: Page) =>
	page.evaluate(() => {
		const audio = document.querySelector("audio");
		return audio ? audio.currentTime : null;
	});

const elapsedSeconds = async (page: Page) => {
	const text = (await statusBar(page).innerText()).replace(/\s+/g, " ");
	const match = /(\d+):(\d\d)\s*\/\s*\d+:\d\d/.exec(text);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const streamRequests = (player: FakePlayer) =>
	player.requests.filter((entry) => entry.path.split("?")[0] === "/api/stream");

const ticketRequests = (player: FakePlayer) =>
	requestsTo(player, "/api/stream/ticket").filter(
		(entry) => entry.method === "POST",
	);

// Choosing does not dismiss the panel -- the chosen row is where the connection
// reports itself -- so every helper below leaves it open.
const startListening = async (page: Page) => {
	await listenButton(page).click();
	await thisDevice(page).click();
};

const picker = (page: Page) => page.getByRole("group", { name: "Playing on" });

// By its name rather than by its role: the row is a button only where pressing
// it would do something, and by its note never -- the note is the whole point of
// that row and says something different in every state it has.
const thePlayer = (page: Page) =>
	picker(page).getByText("foobar2000", { exact: true });

// One per device the sound reaches, and the same bars a playing row carries in a
// track list.
const marks = (within: Locator) => within.locator("[data-paused]");

test.describe("where the picker sits", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	// The button is a third of the way in from the right edge at every width, so a
	// panel whose right edge is the button's hangs off the left of a phone.
	test("it is on the screen, both ends, wherever it was opened from", async ({
		page,
		isMobile,
	}) => {
		await page.goto("/");

		const width = page.viewportSize()?.width ?? 0;
		const check = async (where: string) => {
			const box = (await picker(page).boundingBox())!;
			expect(box.x, `${where}: ran off the left`).toBeGreaterThanOrEqual(0);
			expect(
				box.x + box.width,
				`${where}: ran off the right`,
			).toBeLessThanOrEqual(width);
		};

		await listenButton(page).click();
		await check("the status bar");

		if (!isMobile) return;

		// The screen replaces the status bar on a phone, so the same panel opens
		// from the transport instead -- a different anchor and the same answer.
		await page.keyboard.press("Escape");
		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", {
				name: /Choose where to play|Playing on this device/,
			})
			.click();
		await check("the now-playing transport");
	});

	// It clears the controls it was opened from, or choosing an output puts Play
	// out of reach for as long as the panel is up.
	test("and never over the transport that opened it", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the desktop bar has room beside the button");
		await page.goto("/");
		await openNowPlaying(page);

		const play = nowPlayingScreen(page).getByRole("button", {
			name: /Play|Pause/,
		});
		const before = (await play.boundingBox())!;

		await nowPlayingScreen(page)
			.getByRole("button", {
				name: /Choose where to play|Playing on this device/,
			})
			.click();

		const panel = (await picker(page).boundingBox())!;
		expect(
			panel.y + panel.height,
			"the panel reached the transport",
		).toBeLessThanOrEqual(before.y);
	});
});

// A phone at the edge of a house answers the cross-origin probe slowly, and a
// probe cached as unreachable takes the whole picker away -- `ListenHere`
// renders nothing at all when the component is not ready, so there is not even a
// button left to press. Settings has a "Check again"; the footer is where
// somebody actually is.
test.describe("a probe that is slower than the timeout", () => {
	test.use({
		fooJean: { slowStatus: 1 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});
	test.setTimeout(90_000);

	test("the picker turns up on its own, with nothing pressed in Settings", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(listenButton(page)).toBeVisible({ timeout: 60_000 });
		await listenButton(page).click();
		await expect(thisDevice(page)).toBeVisible();
	});
});

test.describe("listening on this device", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("takes a ticket and opens the stream", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// One ticket per connect, not per request: Safari probes with a `Range`
		// before fetching for real, so a ticket good once could not serve it.
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
	});

	test("asks for the format the server put first", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// The server's order is the quality order and the client only excludes, so
		// Chromium, which plays both, asks for the first.
		await expect.poll(() => player.streamFormats).toEqual(["opus"]);
	});

	test("advances the element's clock", async ({ page }) => {
		await page.goto("/");
		await startListening(page);

		// Polled tightly rather than on the default backoff, which reaches a second
		// between polls while this is watching a clock tick.
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
		const first = await currentTime(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan((first ?? 0) + 0.3);
	});

	test("hands the sound back to the player", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		await thePlayer(page).click();

		// Released, not merely paused: the connection has to go, or the component
		// keeps counting this device against `maxConcurrentStreams`.
		await expect.poll(() => currentTime(page)).toBe(0);
	});

	test("the row says it is listening, says how to stop, and is the stop", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		// Off, the row is an invitation rather than a description of a state.
		await expect(picker(page)).toContainText("Listen here");
		await expect(marks(picker(page))).toHaveCount(1);

		await thisDevice(page).click();
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		// The mark moves rather than multiplying: the player goes silent for the
		// length of the stream, so there is still exactly one device with the sound.
		await expect(picker(page)).toContainText("Listening here");
		await expect(picker(page)).toContainText("Stop");
		await expect(marks(picker(page))).toHaveCount(1);

		// Pressing the row it is on, rather than hunting for the player's.
		await thisDevice(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expect(picker(page)).toContainText("Listen here");
	});

	test("the toggle is this device's alone", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);

		// Nothing about listening may reach the player's own settings namespace.
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/clientconfig").filter(
					(entry) => entry.method === "POST",
				),
			[],
		);
	});

	test("no ticket and no token appears in a URL", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);

		// The bearer token travels in a header and must never be in a query
		// string; the ticket is the credential that may be.
		for (const entry of player.requests)
			expect(entry.path).not.toContain(FOO_JEAN_TOKEN);
		expect(page.url()).not.toContain(FOO_JEAN_TOKEN);
	});
});

test.describe("choosing a codec", () => {
	// The browser is served bytes that are not the declared type for the first
	// format, which is what the fall-through is for.
	test.use({
		fooJean: {
			streamFormats: ["opus", "aac"],
			playableFormats: ["aac"],
		},
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("falls to the second format without a reload", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);

		await expect
			.poll(() => player.streamFormats, { timeout: 20_000 })
			.toEqual(["opus", "aac"]);
		// A fresh ticket for the second attempt: a reconnect never reuses one.
		await expectSettlesAt(player, () => ticketRequests(player).length, 2);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
	});
});

// The short buffer is what every browser that can decode WebM/Opus gets by default. What is
// tested here is the other half of that promise: a stream it cannot read must cost a moment,
// not the session's audio.
test.describe("a stream the short-buffer path cannot read", () => {
	test.use({
		fooJean: {},
		settings: { "jean.lowLatencyStream": true },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("falls back to the browser's own buffer rather than going silent", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);

		// The fake stream is not Ogg, so nothing can be demuxed out of it. Sound still has to
		// arrive, by the path that does not need to understand the container.
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
	});

	test("says so, rather than leaving the setting looking untouched", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.getByText(/kept running dry/i)).toBeVisible();
	});
});

test.describe("an install with no encoder", () => {
	test.use({ fooJean: { canStream: false }, fooJeanToken: FOO_JEAN_TOKEN });

	test("does not offer the control at all", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page).getByRole("button")).not.toHaveCount(0);
		await expect(listenButton(page)).toHaveCount(0);
	});
});

test.describe("the picker on the now-playing screen", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	// The phone's screen replaces the status bar, so without a copy here the one
	// control that says where the sound is going is unreachable while it is open.
	test.skip(
		({ isMobile }) => !isMobile,
		"the desktop screen draws no transport: the status bar under it carries both",
	);

	test("is beside the fader, and opens onto the same two outputs", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await expect(statusBar(page)).toHaveCount(0);

		const screen = nowPlayingScreen(page);
		await screen
			.getByRole("button", { name: /Choose where to play|Playing on this/ })
			.click();

		await expect(picker(page)).toBeVisible();
		await expect(thePlayer(page)).toBeVisible();
		await expect(thisDevice(page)).toBeVisible();
	});

	test("hands the sound to this device from there", async ({ page }) => {
		await page.goto("/");
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Choose where to play|Playing on this/ })
			.click();
		await thisDevice(page).click();

		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
	});
});

test.describe("with no component at all", () => {
	test.use({ fooJean: null, fooJeanToken: null });

	test("is exactly the app it was before", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page)).toBeVisible();
		await expect(listenButton(page)).toHaveCount(0);
	});
});

test.describe("a busy component", () => {
	test.use({
		fooJean: {
			failTickets: 503,
			ticketError: "too many listeners",
		},
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("reads as busy rather than as not supported", async ({ page }) => {
		await page.goto("/");
		await startListening(page);

		await expect(
			page.getByText(/already streaming to as many devices/i),
		).toBeVisible();
	});
});

test.describe("an expired ticket", () => {
	test.use({ fooJean: { expireTickets: true }, fooJeanToken: FOO_JEAN_TOKEN });

	test("retries with a fresh one rather than giving up at once", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);

		// A 401 on the stream reaches the element only as "cannot play this", so it
		// falls through the formats and keeps asking, each attempt with its own
		// ticket.
		await expect
			.poll(() => ticketRequests(player).length, { timeout: 20_000 })
			.toBeGreaterThan(1);
	});
});

test.describe("a stream that ends", () => {
	test.use({
		fooJean: { streamBehaviour: "short" },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("reconnects with a fresh ticket", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		await expect
			.poll(() => streamRequests(player).length, { timeout: 20_000 })
			.toBeGreaterThan(1);
		await expect
			.poll(() => ticketRequests(player).length, { timeout: 20_000 })
			.toBeGreaterThan(1);
	});

	// One device, one socket. A reconnect that opened a second without closing the
	// first would keep pulling the live stream and would count against the
	// component's `maxConcurrentStreams` for as long as the tab is open, which
	// `requests` cannot show because it only ever grows.
	test("and never holds two connections at once", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		await expect
			.poll(() => streamRequests(player).length, { timeout: 20_000 })
			.toBeGreaterThan(2);

		expect(player.peakStreams).toBeLessThanOrEqual(1);
	});
});

test.describe("a stream that goes quiet", () => {
	test.use({
		fooJean: { streamBehaviour: "quiet" },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("says the player is stopped rather than nothing at all", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);

		// No error to catch: the element never fires `playing` and `currentTime`
		// never moves, so the watchdog asks beefweb which of the two it is.
		await expect
			.poll(async () => (await picker(page).textContent()) ?? "", {
				timeout: 25_000,
			})
			.toMatch(/stopped/i);
	});
});

// Two tracks far enough apart in the Library fixture to have nothing in common.
const HEARD = { index: 2, title: "Deléctrico" };
const NEXT = { index: 40, title: "Goodnite, Noises Everywhere" };

test.describe("what is audible, not what the player is doing", () => {
	// The lag is `12 - prime`; the default of fifteen leaves none. See
	// `test/README.md`.
	test.use({ fooJean: { streamPrime: 6 }, fooJeanToken: FOO_JEAN_TOKEN });

	// Real time is the thing under test.
	test.setTimeout(120_000);

	// Everything asserted between the switch and the resume runs inside the lag, and
	// the lag is what is being measured -- so it takes a budget of its own, well under
	// it. The suite's ceiling is longer than the lag, and left on that one slow
	// visibility check outlives the window it sits in: the readout catches up while
	// the check is still polling, and a delay that worked reads as one that never
	// happened.
	const INSIDE_LAG = { timeout: 3000 };

	test("stays on the track still coming out of the speaker", async ({
		page,
		player,
	}) => {
		// `#/home` rather than the front door throughout this describe: the front
		// door reopens the now-playing screen over whatever is playing, and every
		// test here starts playback the moment the app has loaded.
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		// Two minutes in, so the audible point lands inside this track.
		player.patchPlayer({ position: 120 });
		await expect(statusBar(page)).toContainText(HEARD.title);

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		player.playItem("p7", NEXT.index);
		// Playback state is never delayed, so the button flipping proves the app has
		// the new track and is choosing not to draw it.
		player.patchPlayer({ playbackState: "paused" });
		await expect(
			statusBar(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible(INSIDE_LAG);

		await expect(statusBar(page)).toContainText(HEARD.title, INSIDE_LAG);
		await expect(statusBar(page)).not.toContainText(NEXT.title, INSIDE_LAG);

		// A delay, not a freeze: it arrives when the audio does.
		player.patchPlayer({ playbackState: "playing" });
		await expect(statusBar(page)).toContainText(NEXT.title, {
			timeout: 60_000,
		});
	});

	test("the readout runs behind the player, by the buffer", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the readout is desktop-only");
		await page.goto("/#/home");
		// Wall clock is the reference: the fake pushes on change and never on a
		// timer, so its stored `position` stays where the last push left it.
		const startedAt = Date.now();
		player.playItem("p7", HEARD.index);

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		// The bound is wide: what is asserted is that a correction is applied at
		// all and in the right direction. On the fake it comes to about six seconds.
		await expect
			.poll(
				async () => {
					const shown = await elapsedSeconds(page);
					return shown === null
						? null
						: (Date.now() - startedAt) / 1000 - shown;
				},
				{ timeout: 60_000, intervals: TICK },
			)
			.toBeGreaterThan(2);

		const shown = await elapsedSeconds(page);
		expect((Date.now() - startedAt) / 1000 - (shown ?? 0)).toBeLessThan(20);
	});

	test("a pause pressed here still answers at once", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		player.patchPlayer({ position: 120 });

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		// Only the track readout is delayed; the controls answer at once.
		await statusBar(page)
			.getByRole("button", { name: "Pause", exact: true })
			.click();
		await expect(
			statusBar(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	});
});

// The two paths take the clock's origin from different places -- the muxer's own zero, or the
// element's buffer -- so a connection opened after the short buffer is written off has to
// derive it again. Taken from the wrong one, the readout is the live edge and looks exactly
// like a correction that was never applied.
test.describe("the clock once the short buffer is written off", () => {
	test.use({
		fooJean: { streamPrime: 6 },
		settings: { "jean.lowLatencyStream": true },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test.setTimeout(120_000);

	test("still runs behind the player, by the buffer", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the readout is desktop-only");
		await page.goto("/#/home");
		// Wall clock is the reference: the fake pushes on change and never on a
		// timer, so its stored `position` stays where the last push left it.
		const startedAt = Date.now();
		player.playItem("p7", HEARD.index);

		await startListening(page);
		// The fake stream is not Ogg, so the short-buffer path is written off and
		// what produces this sample is the plain connection that replaced it.
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		await expect
			.poll(
				async () => {
					const shown = await elapsedSeconds(page);
					return shown === null
						? null
						: (Date.now() - startedAt) / 1000 - shown;
				},
				{ timeout: 60_000, intervals: TICK },
			)
			.toBeGreaterThan(2);
	});
});

test.describe("who else is listening", () => {
	test.use({
		fooJean: {
			otherListeners: [
				{ deviceId: "phone-1", name: "Android phone", listeningFor: 240 },
				{ deviceId: "phone-2", name: "Android phone", listeningFor: 30 },
				{ deviceId: "laptop-1", name: null, listeningFor: 0 },
			],
		},
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("names them, and tells two of a kind apart", async ({ page }) => {
		await page.goto("/");
		await listenButton(page).click();

		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(3);

		// A guessed label is the same word on two phones of the same make, and a
		// list with two identical rows says nothing.
		await expect(roster).toContainText("Android phone");
		await expect(roster).toContainText("Android phone (2)");

		// A client that named nothing still occupies a row: an empty one would
		// read as a bug rather than as somebody who did not say.
		await expect(roster).toContainText("Unknown device");
		await expect(roster).toContainText("4 min");
	});

	test("the count is on the button before anything is opened", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(listenButton(page)).toHaveText("3");
	});

	test("this device is a row of its own and never also one of the others", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		// The fake groups by the id sent with the ticket, exactly as the component
		// does, so this asserts the id made the round trip.
		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(3);
	});

	test("says why the player is silent, and names who it is silent for", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		// Nothing is listening from here, so the reason is somebody else's doing
		// and the row has to say whose.
		await expect(page.getByRole("group", { name: "Playing on" })).toContainText(
			"Silent while 3 devices are listening",
		);
	});

	test("the player's own fader is what gives it its sound back", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a fader is a mouse gesture");

		await page.goto("/");
		await listenButton(page).click();

		// There is no mute button in this picker: the player's mute is its fader at
		// the bottom of its travel, and the fader is how anyone comes back from it.
		const fader = page.getByRole("slider", { name: "Volume on foobar2000" });
		await expect(fader).toHaveAttribute("aria-valuenow", "0");
		await expect(marks(picker(page))).toHaveCount(0);

		await dragTo(page, fader, 0.6);

		// The component reads the fader moving as the mute no longer being its own,
		// so the row stops explaining a silence that is over.
		await expect(picker(page)).not.toContainText("Silent while");
		await expect(marks(picker(page))).toHaveCount(1);

		// It adds an output rather than taking one away: everybody who was
		// listening still is.
		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(3);
	});

	test("every device the sound reaches carries the same mark", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(marks(roster)).toHaveCount(3);
	});
});

test.describe("saying goodbye", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("a handoff back to the player says it meant to stop", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);

		await thePlayer(page).click();

		// A closed socket says nothing about why it closed, and the component
		// waits out a linger before unmuting in case it was a reconnect. This is
		// what tells it this one was not.
		await expect
			.poll(
				() =>
					requestsTo(player, "/api/stream/leave").filter(
						(entry) => entry.method === "POST",
					).length,
			)
			.toBe(1);
	});

	test("a device that never listened says nothing", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await listenButton(page).click();
		await thePlayer(page).click();

		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/stream/leave").filter(
					(entry) => entry.method === "POST",
				),
			[],
		);
	});
});
