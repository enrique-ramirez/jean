import type { Request } from "@playwright/test";
import {
	countPostsTo,
	deviceAudio,
	expect,
	expectDisabledWithReason,
	expectSettlesAt,
	type FakePlayer,
	globalControls,
	type Locator,
	type Page,
	pickerOpener,
	playingOn,
	putThePickerAway,
	requestsTo,
	statusBar,
	test,
	untilQuiet,
} from "./fixtures.ts";
import { dragTo } from "./gestures.ts";
import {
	currentTime,
	HAND_BACK,
	HEARD,
	listensInItsOwn,
	marks,
	mutesInThePanel,
	playerFader,
	playerRow,
	STOP_HERE,
	startListening,
	stopButtons,
	streamRequests,
	TICK,
	thePlayer,
	ticketRequests,
} from "./listening.ts";
import {
	leaveButton,
	OFFERING_SESSIONS,
	openOnThePlayer,
	ownRow,
	playerRowOf,
	startButton,
	strictOnceSettled,
	thePlayersFace,
} from "./sessions.ts";

// Playwright cannot hear anything, so nothing here asserts on sound -- only on
// what went over the wire and what the audio element believes.

const elapsedSeconds = async (page: Page) => {
	const text = (await statusBar(page).innerText()).replace(/\s+/g, " ");
	const match = /(\d+):(\d\d)\s*\/\s*\d+:\d\d/.exec(text);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const leavesSent = (player: FakePlayer) =>
	requestsTo(player, "/api/stream/leave").filter(
		(entry) => entry.method === "POST",
	).length;

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

		await expect(pickerOpener(page)).toBeVisible();
		await pickerOpener(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
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

		await playingOn(page)
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
		await pickerOpener(page).click();
		await expect(thePlayersFace(page)).toBeVisible();

		await thePlayersFace(page).click();
		await expect
			.poll(() => currentTime(page), { timeout: 20_000, intervals: TICK })
			.toBeGreaterThan(0);

		await expect(
			playerRow(page).getByText("Listening here", { exact: true }),
		).toBeVisible();
		await expect(
			playingOn(page).getByRole("button").filter({ hasText: "foobar2000" }),
		).toHaveCount(0);
		await expect(
			playingOn(page).getByRole("button", { name: /listen here/i }),
		).toHaveCount(0);

		// One way out, whatever it is called, and the word drawn on it is Stop.
		await expect(stopButtons(page)).toHaveCount(1);
		await expect(
			playingOn(page)
				.getByRole("button")
				.filter({ hasText: /^Stop$/ }),
		).toHaveCount(1);
		await expect(
			playerRow(page).getByRole("button", { name: HAND_BACK }),
		).toHaveText("Stop");

		await stopButtons(page).click();
		await expect.poll(() => currentTime(page)).toBe(0);
		await expect(thePlayersFace(page)).toBeVisible();
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
		await expect(pickerOpener(page)).toHaveCount(0);
	});
});

test.describe("a component that is not answering", () => {
	test.use({ fooJean: { reachable: false } });

	test("offers nothing to listen with", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page)).toBeVisible();
		await expect(pickerOpener(page)).toHaveCount(0);
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
			.poll(async () => (await playingOn(page).textContent()) ?? "", {
				timeout: 25_000,
			})
			.toMatch(/stopped/i);
	});
});

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
		await pickerOpener(page).click();

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
		await expect(pickerOpener(page)).toHaveText("3");
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
		await pickerOpener(page).click();

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
		await pickerOpener(page).click();
		await expect(playingOn(page)).toContainText("Silent while");

		expect(await mutesInThePanel(page)).toBe(0);
	});

	test("the player's fader is the picker's own width, wider than the status bar's", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"under a coarse pointer the picker's fader and the status bar's are one width",
		);

		await page.goto("/");
		await pickerOpener(page).click();

		await expect(playerFader(page)).toHaveCSS("width", "104px");
	});

	test("the player's own fader is what gives it its sound back", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a fader is a mouse gesture");

		await page.goto("/");
		await pickerOpener(page).click();

		// There is no mute button in this picker: the player's mute is its fader at
		// the bottom of its travel, and the fader is how anyone comes back from it.
		const fader = page.getByRole("slider", { name: "Volume on foobar2000" });
		await expect(fader).toHaveAttribute("aria-valuenow", "0");
		await expect(marks(thePlayersFace(page))).toHaveCount(0);

		await dragTo(page, fader, 0.6);

		// The component reads the fader moving as the mute no longer being its own,
		// so the row stops explaining a silence that is over.
		await expect(playingOn(page)).not.toContainText("Silent while");
		await expect(marks(thePlayersFace(page))).toHaveCount(1);

		// It adds an output rather than taking one away: everybody who was
		// listening still is.
		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(3);
	});

	test("every device the sound reaches carries the same mark", async ({
		page,
	}) => {
		await page.goto("/");
		await pickerOpener(page).click();

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
		await expect(pickerOpener(page)).toHaveText("2");
		await pickerOpener(page).click();

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
		await pickerOpener(page).click();
		// On the player's name rather than its word: the whole face is the button.
		await thePlayer(page).click();

		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
		await expectSettlesAt(player, () => ticketRequests(player).length, 1);
		expect(leavesSent(player)).toBe(0);
	});
});

const ANOTHER_SESSION_DEVICE = {
	deviceId: "0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a",
	name: null,
};

const OWN_LEVEL = "This device sets its own level. Use its volume buttons.";

const thePlayersFader = (page: Page) =>
	playerRowOf(page).getByRole("slider", { name: /^Volume on foobar2000\b/ });

const startFromThePicker = async (page: Page, player: FakePlayer) => {
	if (!(await playingOn(page).isVisible())) await pickerOpener(page).click();
	await startButton(page).click();
	await expect.poll(() => listensInItsOwn(player)).toBe(true);
	await expect(ownRow(page)).toContainText("Listening here");
	return strictOnceSettled(player);
};

const listeningToItsOwnSession = async (page: Page, player: FakePlayer) => {
	const refused = await openOnThePlayer(page, "/");
	const strict = await startFromThePicker(page, player);
	return { strict, refused };
};

const shutThePicker = async (page: Page, isMobile: boolean) => {
	if (isMobile) await putThePickerAway(page, true);
	else await page.keyboard.press("Escape");
	await expect(playingOn(page)).toBeHidden();
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
		await expect(thePlayersFace(page)).toBeVisible();
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
		const refused = await openOnThePlayer(page, "/");
		await pickerOpener(page).click();
		await expect(playingOn(page)).toContainText(
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
		const refused = await openOnThePlayer(page, "/");
		const bar = statusBar(page);
		if (isMobile)
			await expect(
				bar.getByRole("button", { name: "Show volume" }),
			).toBeVisible();
		else await expect(volumeFadersIn(bar)).toHaveCount(1);

		const strict = await startFromThePicker(page, player);

		const line = ownRow(page).getByText(OWN_LEVEL, { exact: true });
		await expect(line).toBeVisible();
		await expect(playingOn(page).getByText(OWN_LEVEL)).toHaveCount(1);
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
		const refused = await openOnThePlayer(page, "/");
		await startListening(page);
		await expect(
			playerRow(page).getByText(OWN_LEVEL, { exact: true }),
		).toBeVisible();
		await stopButtons(page).click();
		await expect(thePlayersFace(page)).toBeVisible();

		await expect(startButton(page)).toBeVisible();
		const strict = await startFromThePicker(page, player);
		await expect(
			ownRow(page).getByText(OWN_LEVEL, { exact: true }),
		).toBeVisible();
		strict.release();
		expect(refused).toEqual([]);
	});
});
