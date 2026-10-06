import type { Request } from "@playwright/test";
import { NULL_OUTPUT_DEVICE } from "../fake-api/fooJean.ts";
import {
	countPostsTo,
	deviceAudio,
	dragTo,
	expect,
	expectDisabledWithReason,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	type FakePlayer,
	fromTheGrabber,
	globalControls,
	type Locator,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	type Page,
	playRequests,
	putThePickerAway,
	requestsTo,
	restingBox,
	settingsDialog,
	statusBar,
	test,
	toasts,
	touchDrag,
	trackRow,
	untilQuiet,
	watchHowFarItMoves,
} from "./fixtures.ts";

// Playwright cannot hear anything, so nothing here asserts on sound -- only on
// what went over the wire and what the audio element believes.

const TICK = [100, 100, 200];

const listenButton = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

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

const picker = (page: Page) => page.getByRole("group", { name: "Playing on" });

// The player's face is a button only while pressing it would listen here.
const playerFace = (page: Page) =>
	picker(page).getByRole("button", { name: "Listen here", exact: true });

// Choosing does not dismiss the panel -- the player's row is where the connection
// reports itself -- so every helper below leaves it open.
const startListening = async (page: Page) => {
	await listenButton(page).click();
	await playerFace(page).click();
};

// By its name rather than by its role: the face is a button only where pressing
// it would do something.
const thePlayer = (page: Page) =>
	picker(page).getByText("foobar2000", { exact: true });

const playerRow = (page: Page) =>
	picker(page)
		.getByRole("listitem")
		.filter({ has: page.getByText("foobar2000", { exact: true }) });

const HAND_BACK = "Stop, and move the sound back to foobar2000";
const STOP_HERE = "Stop listening here";

// Found by either of its names, so a case that wants one name can count the other.
const stopButtons = (page: Page) =>
	picker(page).getByRole("button", {
		name: new RegExp(`^(${HAND_BACK}|${STOP_HERE})$`),
	});

// WAI-ARIA reads `aria-current="false"` as not current, the same as no attribute.
const currentRows = (page: Page) =>
	picker(page)
		.getByRole("listitem")
		.and(page.locator('[aria-current]:not([aria-current="false"])'));

// The whole panel the button opens, the roster included.
const pickerPanel = (page: Page) => picker(page).locator("xpath=..");

const leavesSent = (player: FakePlayer) =>
	requestsTo(player, "/api/stream/leave").filter(
		(entry) => entry.method === "POST",
	).length;

const playerFader = (page: Page) =>
	picker(page).getByRole("slider", { name: "Volume on foobar2000" });

// A mute on foobar2000 is its fader at the bottom of its travel, so a button for it would be a
// control that disappears at the one level somebody needs it at. Read once the fader beside where it
// would sit is drawn, so an empty count is about a panel that is on screen.
const mutesInThePanel = async (page: Page) => {
	await expect(playerFader(page)).toBeVisible();
	const named = { name: /mute|silence/i };
	return pickerPanel(page)
		.getByRole("button", named)
		.or(pickerPanel(page).getByRole("switch", named))
		.or(pickerPanel(page).getByRole("checkbox", named))
		.count();
};

// One per device the sound reaches, and the same bars a playing row carries in a
// track list.
const marks = (within: Locator) => within.locator("[data-paused]");

const POLL_MS = 1000;
const MARK_FOLLOW_UP_MS = 250;
const MARK_DELAY_MS = 100;
const MARK_IN_HAND_MS = 2 * MARK_FOLLOW_UP_MS;
const SKIP_READ_AFTER_MS = 250;
const SKIP_MARK_DELAY_MS = SKIP_READ_AFTER_MS + MARK_FOLLOW_UP_MS / 2;
const SEEK_MARK_DELAY_MS = 1500;
// Long enough to catch a read on a timer of up to ten seconds.
const QUIET_STRETCH_MS = 11_000;

type Sent = {
	path: string;
	conditional: boolean;
	request: Request;
};

const watchRequests = (page: Page) => {
	const sent: Sent[] = [];
	page.on("request", (request) => {
		sent.push({
			path: new URL(request.url()).pathname,
			conditional: "if-none-match" in request.headers(),
			request,
		});
	});
	return sent;
};

const sentAt = (entry: Sent) => entry.request.timing().startTime;

const timelineReads = (sent: Sent[]) =>
	sent.filter((entry) => entry.path === "/api/stream/timeline");

const lookedAtNow = (sent: Sent[]) =>
	sent.filter((entry) => entry.path === "/api/state" && !entry.conditional);

const polling = (sent: Sent[]) =>
	sent.some((entry) => entry.path === "/api/state" && entry.conditional);

const marksIn = async (entry: Sent) => {
	const response = await entry.request.response();
	const body = (await response?.json().catch(() => null)) as {
		marks?: { path: string; position: number }[];
	} | null;
	return body?.marks ?? [];
};

const playingPath = (player: FakePlayer) => {
	const item = player.player.activeItem;
	const track = player.playlistById(item.playlistId)?.items[item.index];
	return String(track?.["%path%"] ?? "");
};

test.describe("where the picker sits", () => {
	test.use({ fooJean: {} });

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
});

// A check cached as unreachable takes the whole picker away -- `ListenHere`
// renders nothing at all when the component is not ready, so there is not
// even a button left to press. Settings has a "Check again"; the footer is
// where somebody actually is.
test.describe("a first check that times out", () => {
	test("the picker turns up on its own, with nothing pressed in Settings", async ({
		page,
	}) => {
		let refused = 0;
		await page.route(
			(url) => url.pathname === "/api/capabilities",
			(route) => {
				if (refused > 0) return route.continue();
				refused += 1;
				return route.abort("timedout");
			},
		);
		await page.goto("/");

		await expect(listenButton(page)).toBeVisible();
		await listenButton(page).click();
		await expect(playerFace(page)).toBeVisible();
		expect(refused).toBe(1);
	});
});

test.describe("listening on this device", () => {
	test.use({ fooJean: {} });

	// WebKit claims Ogg Opus but refuses the endless WAV the fake sends as opus, so
	// these ask for AAC.
	test.describe("in a format WebKit plays", () => {
		test.use({ fooJean: { streamFormats: ["aac"] } });

		test("takes a ticket and opens the stream", { tag: "@iphone" }, async ({
			page,
			player,
		}) => {
			await page.goto("/");
			await startListening(page);

			// One ticket per connect, not per request: Safari probes with a `Range`
			// before fetching for real, so a ticket good once could not serve it.
			await expectSettlesAt(player, () => ticketRequests(player).length, 1);
			await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
		});

		test("advances the element's clock", { tag: "@iphone" }, async ({
			page,
		}) => {
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
	});

	test("asks for the format the server put first", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// The server's order is the quality order and the client only excludes, so
		// Chromium, which plays both, asks for the first.
		await expect.poll(() => player.streamFormats).toEqual(["opus"]);
	});

	test("Stop hands the sound back to the player, and a press on the player's name does not", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		// The same face listens while it is a button, so a press on it while listening is the stray
		// press that would otherwise silence this device.
		await thePlayer(page).click();
		await untilQuiet(player);
		expect(leavesSent(player)).toBe(0);
		expect(await currentTime(page)).toBeGreaterThan(0);

		await picker(page)
			.getByRole("button", { name: HAND_BACK, exact: true })
			.click();

		// Released, not merely paused: the connection has to go, or the component
		// keeps counting this device against `maxConcurrentStreams`.
		await expect.poll(() => currentTime(page)).toBe(0);
	});

	test("listening, the player's row reads Listening here with one Stop, and its face is no longer a button", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();
		await expect(playerFace(page)).toBeVisible();

		await playerFace(page).click();
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await expect(
			playerRow(page).getByText("Listening here", { exact: true }),
		).toBeVisible();
		await expect(
			picker(page).getByRole("button").filter({ hasText: "foobar2000" }),
		).toHaveCount(0);
		await expect(
			picker(page).getByRole("button", { name: /listen here/i }),
		).toHaveCount(0);

		// One way out, whatever it is called, and the word drawn on it is Stop.
		await expect(stopButtons(page)).toHaveCount(1);
		await expect(
			picker(page)
				.getByRole("button")
				.filter({ hasText: /^Stop$/ }),
		).toHaveCount(1);
		await expect(
			playerRow(page).getByRole("button", { name: HAND_BACK }),
		).toHaveText("Stop");

		await stopButtons(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expect(playerFace(page)).toBeVisible();
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
		isMobile,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await putThePickerAway(page, isMobile);
		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.getByText(/kept running dry/i)).toBeVisible();
	});
});

test.describe("an install with no encoder", () => {
	test.use({ fooJean: { canStream: false } });

	test("does not offer the control at all", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page).getByRole("button")).not.toHaveCount(0);
		await expect(listenButton(page)).toHaveCount(0);
	});
});

test.describe("the picker on the now-playing screen", () => {
	test.use({ fooJean: {} });

	// The phone's screen replaces the status bar, so without a copy here the one
	// control that says where the sound is going is unreachable while it is open.
	test.skip(
		({ isMobile }) => !isMobile,
		"the desktop screen draws no transport: the status bar under it carries both",
	);

	test("is beside the fader, and opens onto the same picker", async ({
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
		await expect(playerFace(page)).toBeVisible();
	});

	test("hands the sound to this device from there", async ({ page }) => {
		await page.goto("/");
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Choose where to play|Playing on this/ })
			.click();
		await playerFace(page).click();

		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
	});
});

test.describe("a component that is not answering", () => {
	test.use({ fooJean: { reachable: false } });

	test("offers nothing to listen with", async ({ page }) => {
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
	test.use({ fooJean: { expireTickets: true } });

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

	// Nothing moves the timeline's revision between connections, so a read that
	// waited for it to move would leave every reconnect without an anchor.
	test("reads the timeline once for every connection it opens", async ({
		page,
		player,
	}) => {
		const sent = watchRequests(page);
		await page.goto("/");
		await startListening(page);

		const connects = () =>
			sent.filter(
				(entry) =>
					entry.path === "/api/stream/ticket" &&
					entry.request.method() === "POST",
			);
		await expect
			.poll(() => connects().length, { timeout: 20_000 })
			.toBeGreaterThan(2);

		const [first, second, third] = connects();
		const readsBetween = (from: Sent, to: Sent) =>
			timelineReads(sent).filter(
				(read) =>
					sent.indexOf(read) > sent.indexOf(from) &&
					sent.indexOf(read) < sent.indexOf(to),
			).length;
		expect([readsBetween(first, second), readsBetween(second, third)]).toEqual([
			1, 1,
		]);
	});

	const SLOW_TICKET_MS = 2500;
	const SHORT_STREAM_SECONDS = 1;

	test("after a reconnect whose ticket is slow, the readout is still where the player is", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the readout is desktop-only");
		let tickets = 0;
		await page.route(
			(url) => url.pathname === "/api/stream/ticket",
			async (route) => {
				tickets += 1;
				if (tickets === 2) {
					player.fooJean.streamBehaviour = "ok";
					await new Promise((settle) => setTimeout(settle, SLOW_TICKET_MS));
				}
				await route.continue();
			},
		);
		await page.goto("/#/home");
		const startedAt = Date.now();
		player.playItem("p7", HEARD.index);

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 30_000, intervals: TICK })
			.toBeGreaterThan(SHORT_STREAM_SECONDS + 1);

		const shown = await elapsedSeconds(page);
		expect(shown).not.toBeNull();
		expect((Date.now() - startedAt) / 1000 - (shown ?? 0)).toBeLessThan(3);
	});
});

test.describe("a stream that goes quiet", () => {
	test.use({
		fooJean: { streamBehaviour: "quiet" },
	});

	test("says the player is stopped rather than nothing at all", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);

		// No error to catch: the element never fires `playing` and `currentTime`
		// never moves, so the watchdog asks `foo_jean` which of the two it is.
		await expect
			.poll(async () => (await picker(page).textContent()) ?? "", {
				timeout: 25_000,
			})
			.toMatch(/stopped/i);
	});
});

// Two tracks far enough apart in the Library fixture to have nothing in common.
const HEARD = { index: 2, title: "Deléctrico" };
const HEARD_ARTIST = "Babasónicos";
const NEXT = { index: 40, title: "Goodnite, Noises Everywhere" };

test.describe("what is audible, not what the player is doing", () => {
	// The lag is `12 - prime`; the default of fifteen leaves none. See
	// `test/README.md`.
	test.use({ fooJean: { streamPrime: 6 } });

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
		isMobile,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		player.patchPlayer({ position: 120 });

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);
		await putThePickerAway(page, isMobile);

		// Only the track readout is delayed; the controls answer at once.
		await statusBar(page)
			.getByRole("button", { name: "Pause", exact: true })
			.click();
		await expect(
			statusBar(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	});

	test.describe("the marks, which land after the change they mark", () => {
		// No lag here, so a mark is heard as soon as it is read and the hold
		// releases on the read rather than on the buffer.
		test.use({ fooJean: { markDelayMs: MARK_DELAY_MS } });

		const aTickLater = async (player: FakePlayer) => {
			const polled = requestsTo(player, "/api/state").length;
			await expect
				.poll(() => requestsTo(player, "/api/state").length)
				.toBeGreaterThan(polled + 1);
		};

		// Starting playback lays marks of its own, and they are a change: the
		// cases below start from a player whose marks are in and seen.
		const listeningTo = async (page: Page, player: FakePlayer, at = 0) => {
			await page.goto("/#/home");
			const marked = player.timelineRevision;
			player.playItem("p7", HEARD.index);
			if (at > 0) player.patchPlayer({ position: at });
			await expect(statusBar(page)).toContainText(HEARD.title);
			await expect
				.poll(() => player.timelineRevision)
				.toBe(marked + (at > 0 ? 2 : 1));
			await aTickLater(player);
			await startListening(page);
			await expect
				.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
				.toBeGreaterThan(0);
			await page.keyboard.press("Escape");
		};

		test("a skip has its mark read before its audio arrives, off one more look at the player a moment later", async ({
			page,
			player,
			isMobile,
		}) => {
			const all = watchRequests(page);
			await listeningTo(page, player);
			await expect.poll(() => polling(all)).toBe(true);
			const heard = playingPath(player);
			const transport = await globalControls(page, isMobile);
			const sent = watchRequests(page);

			// Pressed just after a tick, so the skip's own read is the one that
			// names the new track, and its mark lands between that read and the next.
			player.fooJean.markDelayMs = SKIP_MARK_DELAY_MS;
			await page.waitForRequest(
				(request) =>
					new URL(request.url()).pathname === "/api/state" &&
					"if-none-match" in request.headers(),
			);
			await transport
				.getByRole("button", { name: "Next track", exact: true })
				.click();
			await expect.poll(() => playingPath(player)).not.toBe(heard);
			const next = playingPath(player);
			await expect.poll(() => lookedAtNow(sent).length).toBeGreaterThan(0);
			const [named] = lookedAtNow(sent);

			const markReadAfter = async () => {
				for (const read of timelineReads(sent))
					if ((await marksIn(read)).some((mark) => mark.path === next))
						return sentAt(read) - sentAt(named);
				return null;
			};
			await expect.poll(markReadAfter, { timeout: 15_000 }).not.toBeNull();
			expect(await markReadAfter()).toBeLessThan(MARK_IN_HAND_MS);

			await expectSettlesAt(player, () => lookedAtNow(sent).length, 2);
			const [, followUp] = lookedAtNow(sent);
			expect(sentAt(followUp) - sentAt(named)).toBeGreaterThanOrEqual(
				MARK_FOLLOW_UP_MS,
			);
			expect(sentAt(followUp) - sentAt(named)).toBeLessThan(POLL_MS);
		});

		test("with nobody listening here, a skip is looked at once and no more", async ({
			page,
			player,
			isMobile,
		}) => {
			const all = watchRequests(page);
			await page.goto("/#/home");
			player.playItem("p7", HEARD.index);
			await expect(statusBar(page)).toContainText(HEARD.title);
			await expect.poll(() => polling(all)).toBe(true);
			const heard = playingPath(player);
			const transport = await globalControls(page, isMobile);
			const sent = watchRequests(page);

			player.fooJean.markDelayMs = SKIP_MARK_DELAY_MS;
			await transport
				.getByRole("button", { name: "Next track", exact: true })
				.click();
			await expect.poll(() => playingPath(player)).not.toBe(heard);

			await expectSettlesAt(player, () => lookedAtNow(sent).length, 1);
		});

		test("a seek holds the readout until its own mark is read, and asks for no timeline before that mark exists", async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(isMobile, "the readout is desktop-only");
			const SEEK_TO = 200;
			await listeningTo(page, player, 20);
			const sent = watchRequests(page);

			player.fooJean.markDelayMs = SEEK_MARK_DELAY_MS;
			player.patchPlayer({ position: SEEK_TO });

			await expect
				.poll(() => elapsedSeconds(page), { intervals: TICK })
				.toBe(SEEK_TO);
			await expect
				.poll(() => elapsedSeconds(page), { timeout: 6_000, intervals: TICK })
				.toBeGreaterThan(SEEK_TO + 1);

			await untilQuiet(player);
			const carriesTheSeek = await Promise.all(
				timelineReads(sent).map(async (read) =>
					(await marksIn(read)).some((mark) => mark.position === SEEK_TO),
				),
			);
			expect(carriesTheSeek.length).toBeGreaterThan(0);
			expect(carriesTheSeek).not.toContain(false);
		});

		test("reads no timeline while nothing changes, however long it plays", async ({
			page,
			player,
		}) => {
			const sent = watchRequests(page);
			await listeningTo(page, player);
			await expect.poll(() => timelineReads(sent).length).toBeGreaterThan(0);
			const reads = timelineReads(sent).length;
			const connections = ticketRequests(player).length;

			await page.waitForTimeout(QUIET_STRETCH_MS);

			expect({
				timelineReads: timelineReads(sent).length - reads,
				connectionsOpened: ticketRequests(player).length - connections,
			}).toEqual({ timelineReads: 0, connectionsOpened: 0 });
		});

		test("with nobody listening here, reads no timeline however the marks move", async ({
			page,
			player,
		}) => {
			await page.goto("/#/home");
			player.playItem("p7", HEARD.index);
			await expect(statusBar(page)).toContainText(HEARD.title);

			const moved = player.timelineRevision;
			player.next();
			player.patchPlayer({ position: 60 });
			await expect
				.poll(() => player.timelineRevision)
				.toBeGreaterThanOrEqual(moved + 2);
			await aTickLater(player);

			await expectSettlesAt(
				player,
				() => requestsTo(player, "/api/stream/timeline").length,
				0,
			);
		});
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

test.describe("the Playing on panel", () => {
	test.use({ fooJean: {} });

	test("offers no mute while the player is the one playing, nor once this device listens", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();
		expect(await mutesInThePanel(page)).toBe(0);

		// Listening here silences the player, and the Stop that hands the sound back is the panel
		// saying so. A player held silent is where a mute would be drawn if anywhere.
		await playerFace(page).click();
		await expect(
			picker(page).getByRole("button", { name: HAND_BACK, exact: true }),
		).toBeVisible();
		expect(await mutesInThePanel(page)).toBe(0);
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

	test("offers no mute for a player somebody else has silenced, only its fader", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();
		await expect(picker(page)).toContainText("Silent while");

		expect(await mutesInThePanel(page)).toBe(0);
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
		await expect(marks(playerFace(page))).toHaveCount(0);

		await dragTo(page, fader, 0.6);

		// The component reads the fader moving as the mute no longer being its own,
		// so the row stops explaining a silence that is over.
		await expect(picker(page)).not.toContainText("Silent while");
		await expect(marks(playerFace(page))).toHaveCount(1);

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

	// Others still hear the stream after this device stops, so the player stays silent and nothing
	// is moved back to it.
	test("with others listening, the one Stop is named Stop listening here, stops the stream and sends one leave", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		await expect(stopButtons(page)).toHaveCount(1);
		await expect(stopButtons(page)).toHaveAccessibleName(STOP_HERE);

		await stopButtons(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expectSettlesAt(player, () => leavesSent(player), 1);
	});
});

// Safari probes a source with a range request before fetching it, so one device
// routinely holds two of foo_jean's stream connections, and the component
// reports both the devices and the connections.
test.describe("a device holding several connections", () => {
	test.use({
		fooJean: {
			otherListeners: [
				{ deviceId: "tablet-1", name: "iPad", connections: 2 },
				{ deviceId: "phone-1", name: "Android phone", connections: 3 },
			],
		},
	});

	test("is counted once, on the button and in the list", async ({ page }) => {
		await page.goto("/");
		await expect(listenButton(page)).toHaveText("2");
		await listenButton(page).click();

		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(2);
	});
});

test.describe("saying goodbye", () => {
	test.use({ fooJean: {} });

	test("Stop, as the only listener, says once that it meant to stop", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);

		await expect(stopButtons(page)).toHaveAccessibleName(HAND_BACK);
		await stopButtons(page).click();

		// A closed socket says nothing about why it closed, and the component
		// waits out a linger before unmuting in case it was a reconnect. This is
		// what tells it this one was not.
		await expectSettlesAt(player, () => leavesSent(player), 1);
	});

	test("a press on the player's face listens, with one ticket and no leave", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await listenButton(page).click();
		// On the player's name rather than its word: the whole face is the button.
		await thePlayer(page).click();

		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);
		expect(leavesSent(player)).toBe(0);
	});
});

test.describe("the player's row", () => {
	test.use({ fooJean: {} });

	test("on the player and not listening, its face is the one Listen here in the picker", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		await expect(playerFace(page)).toBeVisible();
		// The face holds the player's name: a Listen here beside the name is the separate row again.
		await expect(playerFace(page)).toContainText("foobar2000");
		await expect(
			playerRow(page).getByRole("button", { name: "Listen here" }),
		).toHaveCount(1);
		await expect(
			picker(page).getByRole("button", { name: /listen here/i }),
		).toHaveCount(1);
		await expect(
			pickerPanel(page).getByText("Listen here", { exact: true }),
		).toHaveCount(1);
	});

	test("is the only row with a slider, and is marked current whether or not this device listens", async ({
		page,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		await expect(playerFace(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText("foobar2000");
		await expect(picker(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRow(page).getByRole("slider")).toHaveCount(1);

		await playerFace(page).click();
		await expect(stopButtons(page)).toBeVisible();
		await expect(currentRows(page)).toHaveCount(1);
		await expect(currentRows(page)).toContainText("foobar2000");
		await expect(picker(page).getByRole("slider")).toHaveCount(1);
		await expect(playerRow(page).getByRole("slider")).toHaveCount(1);
	});

	// A control inside the face is a press that also listens.
	test("holds nothing interactive inside its face", async ({ page }) => {
		await page.goto("/");
		await listenButton(page).click();

		const face = playerFace(page);
		await expect(face).toBeVisible();
		await expect(playerRow(page).getByRole("slider")).toBeVisible();
		await expect(face.getByRole("button")).toHaveCount(0);
		await expect(face.getByRole("slider")).toHaveCount(0);
		await expect(face.getByRole("link")).toHaveCount(0);
	});

	test("its fader moves the player and not this device while this device listens", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);
		await untilQuiet(player);
		const before = await deviceAudio(page);
		const volumes = countPostsTo(player, "/api/volume");

		const fader = playerRow(page).getByRole("slider", {
			name: "Volume on foobar2000",
		});
		await expect(fader).toBeVisible();
		if (isMobile) {
			const box = (await fader.boundingBox())!;
			await fader.tap({ position: { x: box.width * 0.6, y: box.height / 2 } });
		} else await dragTo(page, fader, 0.6);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
		expect(await deviceAudio(page)).toEqual(before);
	});
});

test.describe("the picker on the desktop", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const openFromTheKeyboard = async (page: Page) => {
		await listenButton(page).focus();
		await page.keyboard.press("Enter");
		await expect(picker(page)).toBeVisible();
	};

	const listeningWithThePickerShut = async (page: Page) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);
		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
	};

	test("Enter on the opener opens the picker on the player's face", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);

		await expect(playerFace(page)).toBeFocused();
	});

	test("listening, Enter on the opener opens the picker on Stop", async ({
		page,
	}) => {
		await listeningWithThePickerShut(page);
		await openFromTheKeyboard(page);

		await expect(stopButtons(page)).toBeFocused();
	});

	test("not listening, Tab walks from the face to the player's fader and back", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		const fader = playerRow(page).getByRole("slider");

		await expect(playerFace(page)).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(fader).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(playerFace(page)).toBeFocused();
	});

	test("listening, Tab walks the fader, the cog and then Stop", async ({
		page,
	}) => {
		await listeningWithThePickerShut(page);
		await openFromTheKeyboard(page);
		const fader = playerRow(page).getByRole("slider");
		const cog = playerRow(page).getByRole("button", {
			name: "Output options",
			exact: true,
		});

		await expect(stopButtons(page)).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(cog).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(fader).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(cog).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(stopButtons(page)).toBeFocused();
	});

	test("Escape closes the picker and gives focus back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(playerFace(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await expect(listenButton(page)).toBeFocused();
	});

	// With the player's row the only row there is no row to move to, and the fader is reached by
	// Tab alone.
	test("with one row, the arrows leave focus on the player's face and move no fader", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(playerFace(page)).toBeFocused();

		for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) {
			await page.keyboard.press(key);
			await expect(playerFace(page), key).toBeFocused();
		}
		await untilQuiet(player);
		expect(countPostsTo(player, "/api/volume")).toBe(0);
	});

	// Polled, so a control that takes focus a frame after the swap is not read as having lost it.
	const whereFocusSettles = (page: Page) =>
		expect.poll(() =>
			pickerPanel(page).evaluate((panel) => {
				const focused = document.activeElement;
				if (!focused || focused === document.body) return "body";
				return panel.contains(focused) ? "the picker" : "elsewhere";
			}),
		);

	// A press that swaps the control it was made on would otherwise drop focus to `body`, from where
	// Escape no longer knows to give it back to the opener.
	test("Enter on the player's face listens and leaves focus on Stop, from where Escape gives it back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await expect(playerFace(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(stopButtons(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(stopButtons(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await expect(listenButton(page)).toBeFocused();
	});

	test("open, listen, stop and close by Enter and Escape alone, with focus inside the picker at every step", async ({
		page,
	}) => {
		await page.goto("/");
		await openFromTheKeyboard(page);
		await whereFocusSettles(page).toBe("the picker");
		await expect(playerFace(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(stopButtons(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(stopButtons(page)).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(playerFace(page)).toBeVisible();
		await whereFocusSettles(page).toBe("the picker");
		await expect(playerFace(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await expect(listenButton(page)).toBeFocused();
	});

	test("the popover is 360 pixels wide", async ({ page }) => {
		await page.goto("/");
		await listenButton(page).click();

		const box = (await pickerPanel(page).boundingBox())!;
		expect(Math.round(box.width)).toBe(360);
	});
});

const pickerSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Playing on" });

const closeButton = (page: Page) =>
	pickerSheet(page).getByRole("button", { name: "Close", exact: true });

const openerOnTheScreen = (page: Page) =>
	nowPlayingScreen(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

const openTheSheet = async (page: Page) => {
	await listenButton(page).click();
	await expect(pickerSheet(page)).toBeVisible();
	return pickerSheet(page);
};

// Longer than a sheet on its way out stays drawn, so one still there after it was never closed.
const PAST_ITS_EXIT_MS = 600;

const expectTheSheetStillOpen = async (page: Page) => {
	await page.waitForTimeout(PAST_ITS_EXIT_MS);
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(pickerSheet(page)).toBeVisible();
};

// Either side of the distance the grabber has to travel before letting go closes the sheet, each
// far enough from it that the gesture is unambiguous.
const SHORT_OF_CLOSING_PX = 50;
const PAST_CLOSING_PX = 140;

// A box is fractional, so a sheet back at rest can sit a fraction of a pixel off.
const AT_REST_PX = 1;

// Enough moves that the browser paints the sheet between them.
const DRAG_STEPS = 12;

// The smallest target a fingertip lands on reliably, and the taller one the design gives a face.
const FINGER_PX = 44;
const FACE_PX = 52;
const PILL_WIDTH_PX = 64;

const SHEET_HEIGHT_LIMIT = 0.76;

const expectAtLeast = async (
	target: Locator,
	what: string,
	size: { width?: number; height?: number },
) => {
	await expect(target).toBeVisible();
	const box = (await restingBox(target))!;
	if (size.height !== undefined)
		expect(box.height, `${what}: height`).toBeGreaterThanOrEqual(size.height);
	if (size.width !== undefined)
		expect(box.width, `${what}: width`).toBeGreaterThanOrEqual(size.width);
};

const expectOnTheScreen = (
	page: Page,
	box: { x: number; y: number; width: number; height: number },
	where: string,
) => {
	const viewport = page.viewportSize()!;
	expect(box.x, `${where}: ran off the left`).toBeGreaterThanOrEqual(0);
	expect(box.y, `${where}: ran off the top`).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width, `${where}: ran off the right`).toBeLessThanOrEqual(
		viewport.width,
	);
	expect(
		box.y + box.height,
		`${where}: ran off the bottom`,
	).toBeLessThanOrEqual(viewport.height);
};

test.describe("the picker on a phone is a bottom sheet", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("the opener in the status bar opens a modal dialog named Playing on, holding the player's row and its face", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await expect(page.getByRole("dialog")).toHaveCount(1);
		await expect(sheet).toHaveAttribute("aria-modal", "true");
		await expect(
			sheet.getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(
			sheet
				.getByRole("listitem")
				.filter({ has: page.getByText("foobar2000", { exact: true }) }),
		).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Listen here", exact: true }),
		).toBeVisible();
	});

	test("the opener on the now-playing screen opens the same dialog, holding the same row and face", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();

		const sheet = pickerSheet(page);
		await expect(sheet).toBeVisible();
		await expect(sheet).toHaveAttribute("aria-modal", "true");
		await expect(
			sheet.getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Listen here", exact: true }),
		).toBeVisible();
	});

	test("it is wholly on the screen, from either opener", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);
		expectOnTheScreen(
			page,
			await restingBox(pickerSheet(page)),
			"from the status bar",
		);

		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();
		await expect(pickerSheet(page)).toBeVisible();
		expectOnTheScreen(
			page,
			await restingBox(pickerSheet(page)),
			"from the now-playing screen",
		);
	});

	test("its Close button closes it", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await closeButton(page).click();

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a press on the scrim above it closes it", async ({ page }) => {
		await page.goto("/");
		const box = await restingBox(await openTheSheet(page));

		await page.touchscreen.tap(box.x + box.width / 2, box.y / 2);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("Escape closes it", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await page.keyboard.press("Escape");

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	// The now-playing screen closes on Escape too, and the sheet opened from it is in front of it.
	// A phone's keys are an attached keyboard's.
	test("opened from the now-playing screen, Escape closes the sheet and leaves the screen open, and Escape again closes the screen", async ({
		page,
	}) => {
		await page.goto("/");
		await openNowPlaying(page);
		await openerOnTheScreen(page).click();
		await expect(pickerSheet(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);

		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();
	});

	// As behind a row's action sheet: the sheet is modal, so the transport's keys wait for it.
	test("while it is open, a transport key sends nothing to the player, and Escape still closes it", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openTheSheet(page);
		await expect(playerFace(page)).toBeFocused();

		await page.keyboard.press("ControlOrMeta+.");
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/playback/").filter(
					(entry) => entry.method === "POST",
				),
			[],
		);

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	// A press inside the sheet is not a press outside it: the face swaps for Stop under the finger,
	// and the swap must not read as the press having landed somewhere else.
	test("it stays open after Listen here, and after Stop", async ({ page }) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await sheet
			.getByRole("button", { name: "Listen here", exact: true })
			.click();
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
		await expectTheSheetStillOpen(page);
		await expect(stopButtons(page)).toBeVisible();

		await stopButtons(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expectTheSheetStillOpen(page);
		await expect(playerFace(page)).toBeVisible();
	});

	test("opening it puts focus on the player's face, and Close gives it back to the opener", async ({
		page,
	}) => {
		await page.goto("/");
		await openTheSheet(page);

		await expect(playerFace(page)).toBeFocused();

		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(listenButton(page)).toBeFocused();
	});

	test("listening, opening it puts focus on Stop", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);
		await closeButton(page).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);

		await openTheSheet(page);

		await expect(stopButtons(page)).toBeFocused();
	});

	// The sheet covers the status bar, which is where the track is named everywhere else.
	test("the player's row names the track it plays and its artist", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);

		await openTheSheet(page);

		await expect(playerRow(page)).toContainText(HEARD.title);
		await expect(playerRow(page)).toContainText(HEARD_ARTIST);
	});

	test("the player's row names no track while the player is stopped", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		player.stop();
		await expect(statusBar(page)).not.toContainText(HEARD.title);

		await openTheSheet(page);
		await expect(playerFace(page)).toBeVisible();

		const row = await playerRow(page).innerText();
		expect(row).not.toContain(HEARD.title);
		expect(row).not.toContain(HEARD_ARTIST);
	});
});

test.describe("the picker's sheet goes by a drag down", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"a finger is driven through CDP",
	);

	test("the grabber dragged down past the distance closes it", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);

		await fromTheGrabber(page, sheet, PAST_CLOSING_PX);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a downward drag that begins on its body, past the distance, closes it", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		const heading = await restingBox(sheet.getByRole("heading").first());

		const x = heading.x + heading.width / 2;
		const y = heading.y + heading.height / 2;
		await touchDrag(page, { x, y }, { x, y: y + PAST_CLOSING_PX }, DRAG_STEPS);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("the grabber dragged a shorter way carries it with the finger, and letting go leaves it open where it rested", async ({
		page,
	}) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		const before = await restingBox(sheet);
		const furthest = await watchHowFarItMoves(sheet);

		await fromTheGrabber(page, sheet, SHORT_OF_CLOSING_PX);

		// Settled first, or the box read below is one the sheet passed on its way back.
		const after = await restingBox(sheet);
		expect(
			await furthest(),
			"how far the sheet followed the finger",
		).toBeGreaterThan(AT_REST_PX);
		expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(AT_REST_PX);
		await expectTheSheetStillOpen(page);
	});
});

// Enough listeners that the roster inside the player's row is taller than the sheet may stand.
const MANY_LISTENERS = Array.from({ length: 24 }, (_, index) => ({
	deviceId: `listener-${index + 1}`,
	name: `Listener ${index + 1}`,
	listeningFor: 60 * (index + 1),
}));

test.describe("the picker's sheet holding more than fits", () => {
	test.use({ fooJean: { otherListeners: MANY_LISTENERS } });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	const roster = (page: Page) =>
		pickerSheet(page).getByRole("list", { name: "Also listening" });
	const lastListener = (page: Page) =>
		roster(page).getByRole("listitem").filter({ hasText: "Listener 24" });

	const openItFull = async (page: Page) => {
		await page.goto("/");
		const sheet = await openTheSheet(page);
		await expect(roster(page).getByRole("listitem")).toHaveCount(
			MANY_LISTENERS.length,
		);
		return sheet;
	};

	test("it stands no taller than 76% of the screen, and wholly on it", async ({
		page,
	}) => {
		const sheet = await openItFull(page);

		const box = await restingBox(sheet);
		const viewport = page.viewportSize()!;
		expect(box.height).toBeLessThanOrEqual(
			viewport.height * SHEET_HEIGHT_LIMIT + AT_REST_PX,
		);
		expectOnTheScreen(page, box, "the sheet");
	});

	test("scrolled to the end of its list, its heading and Close are still in view", async ({
		page,
	}) => {
		const sheet = await openItFull(page);
		const before = await restingBox(sheet);
		const last = await restingBox(lastListener(page));
		expect(
			last.y,
			"the last listener starts out below the sheet's edge",
		).toBeGreaterThan(before.y + before.height);

		await lastListener(page).scrollIntoViewIfNeeded();

		const box = await restingBox(sheet);
		const shown = await restingBox(lastListener(page));
		expect(
			shown.y + shown.height,
			"the last listener, shown",
		).toBeLessThanOrEqual(box.y + box.height + AT_REST_PX);
		for (const [what, target] of [
			["the heading", sheet.getByRole("heading", { name: "Playing on" })],
			["Close", closeButton(page)],
		] as const) {
			const at = await restingBox(target);
			expect(at.y, `${what}: scrolled above the sheet`).toBeGreaterThanOrEqual(
				box.y - AT_REST_PX,
			);
			expect(at.y + at.height, `${what}: below the sheet`).toBeLessThanOrEqual(
				box.y + box.height,
			);
		}
		await expect(closeButton(page)).toBeInViewport();
	});

	test("a downward drag begun on its body, with its list at the top, closes it", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);

		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await touchDrag(page, { x, y }, { x, y: y + PAST_CLOSING_PX }, 12);

		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("a downward drag begun on its list scrolled away from the top scrolls it back and moves the sheet nowhere", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);
		const first = roster(page).getByRole("listitem").first();
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			12,
		);
		const scrolled = await restingBox(first);
		expect(scrolled.y, "the first listener, scrolled up").toBeLessThan(box.y);
		const furthest = await watchHowFarItMoves(sheet);

		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.5 },
			{ x, y: box.y + box.height * 0.5 + PAST_CLOSING_PX },
			12,
		);

		const after = await restingBox(first);
		expect(after.y, "the first listener, scrolled back").toBeGreaterThan(
			scrolled.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await expectTheSheetStillOpen(page);
	});

	test("a drag up its list scrolls the list and moves the sheet nowhere", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");
		const sheet = await openItFull(page);
		const box = await restingBox(sheet);
		const first = roster(page).getByRole("listitem").first();
		const firstBefore = await restingBox(first);
		const furthest = await watchHowFarItMoves(sheet);

		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.8 },
			{ x, y: box.y + box.height * 0.3 },
			12,
		);

		const firstAfter = await restingBox(first);
		expect(firstAfter.y, "the first listener, scrolled up").toBeLessThan(
			firstBefore.y,
		);
		expect(await furthest(), "how far the sheet moved").toBeLessThanOrEqual(
			AT_REST_PX,
		);
		await expectTheSheetStillOpen(page);
	});
});

// Named the way foobar2000 lists outputs on Windows, with ids of the shape it answers.
const SPEAKERS = {
	id: "5B0C0E5E-3C1D-4D6A-8E2F-1A2B3C4D5E6F:1F2E3D4C-5B6A-4978-8A9B-0C1D2E3F4A5B",
	name: "Speakers [WASAPI]",
};
const HEADPHONES = {
	id: "5B0C0E5E-3C1D-4D6A-8E2F-1A2B3C4D5E6F:6A5B4C3D-2E1F-4A0B-9C8D-7E6F5A4B3C2D",
	name: "Headphones [WASAPI]",
};
const TWO_OUTPUTS = {
	outputDevices: [SPEAKERS, HEADPHONES],
	activeOutput: SPEAKERS.id,
};

const listeningInTheSheet = async (page: Page) => {
	await page.goto("/");
	await startListening(page);
	await expect
		.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
		.toBeGreaterThan(0);
	await expect(pickerSheet(page)).toBeVisible();
};

const outputOptions = (page: Page) =>
	pickerSheet(page).getByRole("button", {
		name: "Output options",
		exact: true,
	});

const outputList = (page: Page) =>
	pickerSheet(page).getByRole("radiogroup", { name: "Output device" });

test.describe("the output page behind the cog, in the picker's sheet", () => {
	test.use({ fooJean: TWO_OUTPUTS });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("the cog turns the sheet to the output devices in place, and Back turns it back to the rows", async ({
		page,
	}) => {
		await listeningInTheSheet(page);

		await outputOptions(page).click();
		await expect(outputList(page)).toBeVisible();
		await expect(outputList(page).getByRole("radio")).toHaveCount(2);
		await expect(page.getByRole("dialog")).toHaveCount(1);

		await pickerSheet(page)
			.getByRole("button", { name: "Back", exact: true })
			.click();
		await expect(
			pickerSheet(page).getByRole("group", { name: "Playing on" }),
		).toBeVisible();
		await expect(outputList(page)).toHaveCount(0);
		await expect(stopButtons(page)).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(1);
	});
});

const SWITCH_FAILED = "We couldn’t switch the output device";

test.describe("a toast raised while the picker's sheet is open", () => {
	test.use({ fooJean: { ...TWO_OUTPUTS, outputSwitchRefusal: 500 } });
	test.skip(({ isMobile }) => !isMobile, "the desktop keeps its popover");

	test("is drawn above the sheet, so a press at its centre reaches it", async ({
		page,
	}) => {
		await listeningInTheSheet(page);
		await outputOptions(page).click();
		await outputList(page)
			.getByRole("radio", { name: HEADPHONES.name, exact: true })
			.click();

		const toast = toasts(page)
			.locator("xpath=..")
			.filter({ hasText: SWITCH_FAILED });
		await expect(toast).toBeVisible();
		await expect(pickerSheet(page)).toBeVisible();

		const box = await restingBox(toast);
		const reached = await page.evaluate(
			({ x, y, text }) => {
				const hit = document.elementFromPoint(x, y);
				return Boolean(
					hit?.closest('[role="status"]')?.textContent?.includes(text),
				);
			},
			{
				x: box.x + box.width / 2,
				y: box.y + box.height / 2,
				text: SWITCH_FAILED,
			},
		);
		expect(reached, "the press at the toast's centre landed on it").toBe(true);

		await toast.getByRole("button", { name: "Dismiss" }).tap();
		await expect(page.getByText(SWITCH_FAILED)).toHaveCount(0);
	});
});

test.describe("the picker's touch targets on a phone", () => {
	test.use({ fooJean: TWO_OUTPUTS });
	test.skip(({ isMobile }) => !isMobile, "these are a finger's sizes");

	test("the player's face is at least 52 pixels tall", async ({ page }) => {
		await page.goto("/");
		await listenButton(page).click();

		await expectAtLeast(playerFace(page), "the face", { height: FACE_PX });
	});

	test("Stop is at least 44 pixels tall and 64 wide", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await expectAtLeast(stopButtons(page), "Stop", {
			height: FINGER_PX,
			width: PILL_WIDTH_PX,
		});
	});

	test("the player's fader takes a touch 44 pixels tall", async ({ page }) => {
		await page.goto("/");
		await listenButton(page).click();

		await expectAtLeast(playerFader(page), "the fader", { height: FINGER_PX });
	});

	test("Close is at least 44 by 44", async ({ page }) => {
		await page.goto("/");
		await openTheSheet(page);

		await expectAtLeast(closeButton(page), "Close", {
			height: FINGER_PX,
			width: FINGER_PX,
		});
	});

	test("the status bar's opener and its volume button are each at least 44 by 44", async ({
		page,
	}) => {
		await page.goto("/");

		await expectAtLeast(listenButton(page), "the opener", {
			height: FINGER_PX,
			width: FINGER_PX,
		});
		await expectAtLeast(
			statusBar(page).getByRole("button", { name: "Show volume" }),
			"the volume button",
			{ height: FINGER_PX, width: FINGER_PX },
		);
	});
});

const NO_SPEAKERS = "foobar2000 is not playing through any speakers.";

// Both listed, as foobar2000 lists its Null Output beside the real devices, so a switch between them
// is one the player could make.
const ON_SPEAKERS = {
	outputDevices: [SPEAKERS, NULL_OUTPUT_DEVICE],
	activeOutput: SPEAKERS.id,
};
const ON_NOTHING = { ...ON_SPEAKERS, activeOutput: NULL_OUTPUT_DEVICE.id };

const noSpeakers = (page: Page) =>
	page.getByText(NO_SPEAKERS, { exact: true }).filter({ visible: true });

// The fader's level arrives on the same poll as `outputSilent`, so once it is drawn the picker
// has read whether the player can be heard, and an absence after that is not one still loading.
const openThePickerOnThePoll = async (page: Page) => {
	await listenButton(page).click();
	await expect(playerFace(page)).toBeVisible();
	await expect(playerFader(page)).toBeVisible();
};

const expectOfferedFirst = async (page: Page) => {
	await expect(playerFace(page)).toContainText(NO_SPEAKERS);
	// One target for the act: a second Listen here, or a row of its own ahead of the player's,
	// is the offer drawn beside the face rather than as it.
	await expect(
		picker(page).getByRole("button", { name: /listen here/i }),
	).toHaveCount(1);
	await expect(noSpeakers(page)).toHaveCount(1);
	const firstRow = picker(page).getByRole("listitem").first();
	await expect(firstRow).toContainText("foobar2000");
	await expect(
		firstRow.getByRole("button", { name: "Listen here", exact: true }),
	).toContainText(NO_SPEAKERS);
};

const turnOffTheOffer = async (page: Page) => {
	await openSettings(page);
	const offer = settingsDialog(page).getByRole("switch", {
		name: /^Offer listening here when the player cannot be heard/,
	});
	await offer.click();
	await expect(offer).not.toBeChecked();
	await page.getByRole("button", { name: "Close settings" }).click();
	await expect(settingsDialog(page)).toBeHidden();
};

const expectNothingOffered = async (page: Page) => {
	await expect(playerFace(page)).toBeVisible();
	await expect(playerFace(page)).toContainText("foobar2000");
	await expect(noSpeakers(page)).toHaveCount(0);
};

test.describe("a player nobody can hear", () => {
	test.use({ fooJean: ON_NOTHING });

	test("on the player and not listening, the player's face is the Listen here that says foobar2000 is not playing through any speakers, in the first row", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectOfferedFirst(page);
	});

	test("a press on the offered face listens, with one ticket and the stream opened", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expect(playerFace(page)).toContainText(NO_SPEAKERS);

		await playerFace(page).click();

		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);
	});

	test("listening here, the sentence is gone and the row reads Listening here with its Stop, and Stop brings the offer back", async ({
		page,
	}) => {
		await page.goto("/");
		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 15_000 })
			.toBeGreaterThan(0);

		await expect(picker(page)).toContainText("Listening here");
		await expect(stopButtons(page)).toHaveAccessibleName(HAND_BACK);
		await expect(noSpeakers(page)).toHaveCount(0);

		await stopButtons(page).click();
		await expectOfferedFirst(page);
	});

	test("while listening is offered, the player's fader is still in its row and moves the player", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expect(playerFace(page)).toContainText(NO_SPEAKERS);
		await untilQuiet(player);
		const volumes = countPostsTo(player, "/api/volume");

		const fader = playerRow(page).getByRole("slider", {
			name: "Volume on foobar2000",
		});
		await expect(fader).toBeEnabled();
		if (isMobile) {
			const box = (await fader.boundingBox())!;
			await fader.tap({ position: { x: box.width * 0.6, y: box.height / 2 } });
		} else await dragTo(page, fader, 0.6);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
	});

	test("while listening is offered, the player's row draws no bars beside its name, though the player plays", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await openThePickerOnThePoll(page);
		await expectOfferedFirst(page);

		expect(await marks(playerRow(page)).count()).toBe(0);
	});

	test("with the Settings switch off, the player's face draws its bars beside its name while it plays, as when it can be heard", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await turnOffTheOffer(page);
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
		await expect(marks(playerFace(page))).toHaveCount(1);
	});

	test.describe("with playback control off", () => {
		test.use({ fooJean: { ...ON_NOTHING, canControlPlayback: false } });

		// Listening is the stream, which `foo_jean` serves whatever `canControlPlayback` says.
		test("listening is still offered first, and the press listens", async ({
			page,
			player,
		}) => {
			await page.goto("/");
			await openThePickerOnThePoll(page);

			await expectOfferedFirst(page);

			await playerFace(page).click();
			await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
			await expectSettlesAt(player, () => ticketRequests(player).length, 1);
		});
	});

	test.describe("on an install that cannot stream", () => {
		test.use({ fooJean: { ...ON_NOTHING, canStream: false } });

		test("nothing is offered, and nothing says the player cannot be heard", async ({
			page,
			player,
		}) => {
			await page.goto("/");
			// Two polls asked after the first, so the first has been answered and drawn.
			await expect
				.poll(() => requestsTo(player, "/api/state").length)
				.toBeGreaterThan(2);

			await expect(listenButton(page)).toHaveCount(0);
			await expect(noSpeakers(page)).toHaveCount(0);
		});
	});
});

test.describe("a player whose output reaches speakers", () => {
	test.use({ fooJean: ON_SPEAKERS });

	test("is offered as before: its face is Listen here, with no sentence about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
	});

	test("its face draws the bars beside the player's name while it plays", async ({
		page,
		player,
	}) => {
		await page.goto("/#/home");
		player.playItem("p7", HEARD.index);
		await expect(statusBar(page)).toContainText(HEARD.title);
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
		await expect(marks(playerFace(page))).toHaveCount(1);
	});

	test("moved by the player onto an output nobody hears, is offered first on the next poll without a reload, and moved back is not", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await page.evaluate(() => {
			(window as unknown as { notReloaded: boolean }).notReloaded = true;
		});
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		player.setActiveOutput(NULL_OUTPUT_DEVICE.id);
		await expectOfferedFirst(page);

		player.setActiveOutput(SPEAKERS.id);
		await expect(noSpeakers(page)).toHaveCount(0);
		await expect(playerFace(page)).toBeVisible();

		expect(
			await page.evaluate(
				() => (window as unknown as { notReloaded?: boolean }).notReloaded,
			),
		).toBe(true);
	});
});

test.describe("a player whose output foo_jean cannot name", () => {
	test.use({ fooJean: { activeOutput: null } });

	test("reads as audible: its face is Listen here, with no sentence about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);

		await expectNothingOffered(page);
	});
});

// A browser falls back to an element's `title` for its description, so the opener has one whether
// or not anything is offered: what the offer adds is the sentence.
const SAYS_NO_SPEAKERS = /not playing through any speakers/;

const screenOpener = (page: Page) =>
	nowPlayingScreen(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

test.describe("the opener while listening is offered first", () => {
	test.use({ fooJean: ON_NOTHING });

	test("says foobar2000 is not playing through any speakers as its description, and keeps its name", async ({
		page,
		isMobile,
	}) => {
		await page.goto("/");

		await expect(listenButton(page)).toHaveAccessibleDescription(NO_SPEAKERS);
		await expect(listenButton(page)).toHaveAccessibleName(
			"Choose where to play",
		);

		if (!isMobile) return;
		await openNowPlaying(page);
		await expect(screenOpener(page)).toHaveAccessibleDescription(NO_SPEAKERS);
		await expect(screenOpener(page)).toHaveAccessibleName(
			"Choose where to play",
		);
	});

	test("with the Settings switch off, says nothing about speakers", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(listenButton(page)).toHaveAccessibleDescription(NO_SPEAKERS);

		await turnOffTheOffer(page);
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		await expect(listenButton(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);
	});

	test("listening here, says nothing about speakers", async ({ page }) => {
		await page.goto("/");
		await startListening(page);
		await expect(picker(page)).toContainText("Listening here");
		await expect(listenButton(page)).toHaveAccessibleName(
			"Playing on this device",
		);

		await expect(listenButton(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);
	});
});

test.describe("the opener of a player whose output reaches speakers", () => {
	test.use({ fooJean: ON_SPEAKERS });

	test("says nothing about speakers, and says it once the player moves onto an output nobody hears", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openThePickerOnThePoll(page);
		await expectNothingOffered(page);

		await expect(listenButton(page)).not.toHaveAccessibleDescription(
			SAYS_NO_SPEAKERS,
		);

		player.setActiveOutput(NULL_OUTPUT_DEVICE.id);
		await expect(listenButton(page)).toHaveAccessibleDescription(NO_SPEAKERS);
	});
});

// The same as sessions.spec.ts's: Playwright refuses a spec that imports another spec.
const SESSION_DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";
const ANOTHER_SESSION_DEVICE = {
	deviceId: "0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a",
	name: null,
};

const OFFERING_SESSIONS = {
	fooJean: { maxSessions: 4, canCreateSessions: true },
	settings: {
		"jean.deviceId": SESSION_DEVICE,
		"jean.deviceName": "Den laptop",
	},
};

const START = "Play something else here";
const LEAVE_NAMED = "Leave, and go back to foobar2000";
const OWN_LEVEL = "This device sets its own level. Use its volume buttons.";

const opener = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /^(Choose where to play|Playing on this device|Playing what .+ started)/,
	});

const pickerRows = (page: Page) =>
	picker(page).getByRole("listitem").and(page.locator("li:not(li li)"));

const thePlayersRow = (page: Page) =>
	pickerRows(page).filter({
		has: page.getByText("foobar2000", { exact: true }),
	});

// Exact: Playwright's `hasText` ignores case, and the player's drift line reads "Runs ahead of this device".
const ownRow = (page: Page) =>
	pickerRows(page).filter({
		has: page.getByText("This device", { exact: true }),
	});

const startButton = (page: Page) =>
	picker(page).getByRole("button", { name: START, exact: true });

const leaveButton = (page: Page) =>
	picker(page).getByRole("button", { name: LEAVE_NAMED, exact: true });

const thePlayersFader = (page: Page) =>
	thePlayersRow(page).getByRole("slider", { name: /^Volume on foobar2000\b/ });

const listensIn = (player: FakePlayer) => {
	const [started, ...more] = player.sessions.list();
	if (!started || more.length > 0) return false;
	return started.roster().some((device) => device.deviceId === SESSION_DEVICE);
};

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

const openOnThePlayer = async (page: Page) => {
	const refused = refusalsFrom(page);
	await page.goto("/");
	await expect(opener(page)).toBeVisible();
	return refused;
};

const startFromThePicker = async (page: Page, player: FakePlayer) => {
	if (!(await picker(page).isVisible())) await opener(page).click();
	await startButton(page).click();
	await expect.poll(() => listensIn(player)).toBe(true);
	await expect(ownRow(page)).toContainText("Listening here");
	return strictOnceSettled(player);
};

const listeningToItsOwnSession = async (page: Page, player: FakePlayer) => {
	const refused = await openOnThePlayer(page);
	const strict = await startFromThePicker(page, player);
	return { strict, refused };
};

const shutThePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) await putThePickerAway(page, true);
	else await page.keyboard.press("Escape");
	await expect(picker(page)).toBeHidden();
};

const volumeFadersIn = (scope: Locator) =>
	scope.getByRole("slider", { name: /^Volume\b/ });

const statusBarFaders = async (page: Page, isMobile: boolean) => {
	const bar = statusBar(page);
	if (isMobile) await bar.getByRole("button", { name: "Show volume" }).click();
	return volumeFadersIn(bar);
};

const moveFader = async (
	page: Page,
	isMobile: boolean,
	fader: Locator,
	fraction: number,
) => {
	await expect(fader).toBeVisible();
	if (!isMobile) return dragTo(page, fader, fraction);
	const box = (await fader.boundingBox())!;
	const vertical = box.height > box.width;
	await fader.tap({
		position: vertical
			? { x: box.width / 2, y: box.height * (1 - fraction) }
			: { x: box.width * fraction, y: box.height / 2 },
	});
};

const deviceLevel = async (page: Page) => (await deviceAudio(page)).volume;

test.describe("the fader while this device listens to a session of its own", () => {
	test.use(OFFERING_SESSIONS);

	test("the status bar holds one fader, this device's, and moving it turns the element and sends the player nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await listeningToItsOwnSession(page, player);
		await shutThePicker(page, isMobile);
		await untilQuiet(player);
		const playerLevel = player.player.volume.value;
		const volumes = countPostsTo(player, "/api/volume");
		const before = await deviceLevel(page);

		const faders = await statusBarFaders(page, isMobile);
		await expect(faders).toHaveCount(1);
		await expect(faders).toHaveAccessibleName("Volume on this device");
		await moveFader(page, isMobile, faders, 0.2);

		await expect.poll(() => deviceLevel(page)).toBeLessThan(before - 0.1);
		await untilQuiet(player);
		expect(countPostsTo(player, "/api/volume")).toBe(volumes);
		expect(player.player.volume.value).toBe(playerLevel);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the player's row's fader leaves this device's level where it was", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await listeningToItsOwnSession(page, player);
		await untilQuiet(player);
		const before = await deviceAudio(page);
		const volumes = countPostsTo(player, "/api/volume");

		await moveFader(page, isMobile, thePlayersFader(page), 0.8);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
		await untilQuiet(player);
		expect(await deviceAudio(page)).toEqual(before);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("leaving puts the status bar's fader back on the player, and moving it sends the player a volume", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await listeningToItsOwnSession(page, player);
		strict.release();
		await leaveButton(page).click();
		await expect.poll(() => player.sessions.list()).toEqual([]);
		await expect(playerFace(page)).toBeVisible();
		await shutThePicker(page, isMobile);
		await untilQuiet(player);
		const playerLevel = player.player.volume.value;
		const volumes = countPostsTo(player, "/api/volume");

		const faders = await statusBarFaders(page, isMobile);
		await expect(faders).toHaveCount(1);
		await expect(faders).toHaveAccessibleName("Volume");
		await moveFader(page, isMobile, faders, 0.8);

		await expect
			.poll(() => countPostsTo(player, "/api/volume"))
			.toBeGreaterThan(volumes);
		await expect.poll(() => player.player.volume.value).not.toBe(playerLevel);
		expect(refused).toEqual([]);
	});
});

test.describe("the fader while this device listens to a session of its own, with playback control off", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: { ...OFFERING_SESSIONS.fooJean, canControlPlayback: false },
	});

	test("the status bar's fader is this device's and still turns it", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await listeningToItsOwnSession(page, player);
		await shutThePicker(page, isMobile);
		await untilQuiet(player);
		const before = await deviceLevel(page);

		const faders = await statusBarFaders(page, isMobile);
		await expect(faders).toHaveCount(1);
		await expect(faders).toHaveAccessibleName("Volume on this device");
		await expect(faders).not.toHaveAttribute("aria-disabled", "true");
		await moveFader(page, isMobile, faders, 0.2);

		await expect.poll(() => deviceLevel(page)).toBeLessThan(before - 0.1);
		await untilQuiet(player);
		expect(countPostsTo(player, "/api/volume")).toBe(0);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the player's row's fader is disabled with the reason, as it is on the player, and moving it sends no volume", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused } = await listeningToItsOwnSession(page, player);
		const fader = thePlayersFader(page);

		await expectDisabledWithReason(fader);
		await fader.click({ force: true });
		if (!isMobile) await dragTo(page, fader, 0.8);

		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
		strict.release();
		expect(refused).toEqual([]);
	});
});

const SILENT_WHILE = "Silent while";

const recordSilentPhrases = (page: Page) =>
	page.evaluate((phrase) => {
		const shown = new Set<string>();
		Object.assign(window, { silentPhrases: shown });
		const look = () => {
			for (const element of document.querySelectorAll("body *")) {
				const own = [...element.childNodes]
					.filter((node) => node.nodeType === Node.TEXT_NODE)
					.map((node) => node.textContent ?? "")
					.join("");
				if (own.includes(phrase)) shown.add(own.trim());
			}
		};
		look();
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, SILENT_WHILE);

const silentPhrasesShown = (page: Page) =>
	page.evaluate(() => [
		...(window as unknown as { silentPhrases: Set<string> }).silentPhrases,
	]);

test.describe("a player held silent by somebody else, while this device listens to a session of its own", () => {
	test.use({
		...OFFERING_SESSIONS,
		fooJean: {
			...OFFERING_SESSIONS.fooJean,
			otherListeners: [
				{ deviceId: "phone-1", name: "Android phone", listeningFor: 240 },
			],
		},
	});

	test("the picker says why the player is silent while on it, and never once while listening to the session", async ({
		page,
		player,
	}) => {
		const refused = await openOnThePlayer(page);
		await opener(page).click();
		await expect(picker(page)).toContainText(
			"Silent while Android phone is listening",
		);

		const strict = await startFromThePicker(page, player);
		await recordSilentPhrases(page);
		const [started] = player.sessions.list();
		player.addSessionListener(started.id, ANOTHER_SESSION_DEVICE);
		await expect(ownRow(page).getByText("Also listening")).toBeVisible();
		await untilQuiet(player);

		expect(await silentPhrasesShown(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

// iOS ignores a write to `audio.volume` and reads back 1.
const ignoreElementVolume = (page: Page) =>
	page.addInitScript(() => {
		Object.defineProperty(HTMLMediaElement.prototype, "volume", {
			configurable: true,
			get: () => 1,
			set: () => {},
		});
	});

test.describe("a device whose audio element ignores its volume", () => {
	test.use(OFFERING_SESSIONS);

	test("listening to a session of its own, the status bar draws no fader, the session's row says the device sets its own level, and the player's row keeps the player's fader", async ({
		page,
		player,
		isMobile,
	}) => {
		await ignoreElementVolume(page);
		const refused = await openOnThePlayer(page);
		const bar = statusBar(page);
		if (isMobile)
			await expect(
				bar.getByRole("button", { name: "Show volume" }),
			).toBeVisible();
		else await expect(volumeFadersIn(bar)).toHaveCount(1);

		const strict = await startFromThePicker(page, player);

		const line = ownRow(page).getByText(OWN_LEVEL, { exact: true });
		await expect(line).toBeVisible();
		await expect(picker(page).getByText(OWN_LEVEL)).toHaveCount(1);
		const listening = ownRow(page).getByText("Listening here", {
			exact: true,
		});
		expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual(
			(await listening.boundingBox())!.y,
		);
		await expect(thePlayersFader(page)).toBeVisible();

		await shutThePicker(page, isMobile);
		await expect(volumeFadersIn(bar)).toHaveCount(0);
		await expect(bar.getByRole("button", { name: "Show volume" })).toHaveCount(
			0,
		);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("having listened on the player and stopped, still offers the start row, and pressing it starts and listens", async ({
		page,
		player,
	}) => {
		await ignoreElementVolume(page);
		const refused = await openOnThePlayer(page);
		await startListening(page);
		await expect(
			playerRow(page).getByText(OWN_LEVEL, { exact: true }),
		).toBeVisible();
		await stopButtons(page).click();
		await expect(playerFace(page)).toBeVisible();

		await expect(startButton(page)).toBeVisible();
		const strict = await startFromThePicker(page, player);
		await expect(
			ownRow(page).getByText(OWN_LEVEL, { exact: true }),
		).toBeVisible();
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the picker from the keyboard, with a track list on screen", () => {
	test.use({ fooJean: {} });
	test.skip(({ isMobile }) => isMobile, "a phone has no keyboard to drive it");

	const SELECTED_ROW = 2;

	const keysPlayed = (player: FakePlayer) =>
		playRequests(player).length +
		countPostsTo(player, "/api/playback/play-pause");

	const withARowSelected = async (page: Page, player: FakePlayer) => {
		await openLibrary(page);
		await trackRow(page, SELECTED_ROW).click();
		await expect(trackRow(page, SELECTED_ROW)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await untilQuiet(player);
		const before = keysPlayed(player);
		return async () => {
			await untilQuiet(player);
			return keysPlayed(player) - before;
		};
	};

	const selectedRows = (page: Page) =>
		page
			.locator('main [role="row"][aria-selected="true"]')
			.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row")));

	const openThePicker = async (page: Page) => {
		await listenButton(page).click();
		await expect(picker(page)).toBeVisible();
	};

	for (const key of ["Enter", "Space"]) {
		test(`${key} on the opener opens the picker on the player's face`, async ({
			page,
			player,
		}) => {
			await withARowSelected(page, player);
			await listenButton(page).focus();
			await page.keyboard.press(key);

			await expect(picker(page)).toBeVisible();
			await expect(playerFace(page)).toBeFocused();
		});

		test(`opened by ${key}, Escape gives focus back to the opener, and the list took none of the keys`, async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await listenButton(page).focus();
			await page.keyboard.press(key);
			await expect(playerFace(page)).toBeFocused();

			await page.keyboard.press("Escape");
			await expect(picker(page)).toBeHidden();
			await expect(listenButton(page)).toBeFocused();

			expect(await played()).toBe(0);
			expect(await selectedRows(page)).toEqual([String(SELECTED_ROW)]);
		});

		test(`${key} on the player's face listens here and plays nothing in the list`, async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await openThePicker(page);
			const ticketsBefore = ticketRequests(player).length;
			await playerFace(page).focus();
			await page.keyboard.press(key);

			await expect(stopButtons(page)).toBeVisible();
			expect(ticketRequests(player).length).toBeGreaterThan(ticketsBefore);
			expect(await played()).toBe(0);
		});
	}

	test("listening here, Enter on Stop stops and plays nothing in the list", async ({
		page,
		player,
	}) => {
		const played = await withARowSelected(page, player);
		await openThePicker(page);
		await playerFace(page).click();
		await expect(stopButtons(page)).toBeVisible();
		await untilQuiet(player);
		const before = await played();

		await stopButtons(page).focus();
		await page.keyboard.press("Enter");

		await expect(playerFace(page)).toBeVisible();
		expect(await played()).toBe(before);
	});

	test("with the picker open and focus back on the page, Space still plays and pauses", async ({
		page,
		player,
	}) => {
		await withARowSelected(page, player);
		await openThePicker(page);
		await page.evaluate(() => (document.activeElement as HTMLElement).blur());
		await untilQuiet(player);
		const before = countPostsTo(player, "/api/playback/play-pause");

		await page.keyboard.press("Space");

		await expect
			.poll(() => countPostsTo(player, "/api/playback/play-pause"))
			.toBe(before + 1);
		await expect(picker(page)).toBeVisible();
	});

	test.describe("with a session on offer", () => {
		test.use(OFFERING_SESSIONS);

		test("Enter on the start row starts a session here and plays nothing in the list", async ({
			page,
			player,
		}) => {
			const played = await withARowSelected(page, player);
			await openThePicker(page);
			await startButton(page).focus();
			await page.keyboard.press("Enter");

			await expect.poll(() => listensIn(player)).toBe(true);
			expect(await played()).toBe(0);
		});
	});
});
