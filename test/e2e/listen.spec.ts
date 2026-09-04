import {
	expect,
	type FakePlayer,
	type Page,
	requestsTo,
	statusBar,
	test,
} from "./fixtures.ts";

// Playwright cannot hear anything, so nothing here asserts on sound -- only on
// what went over the wire and what the audio element believes.

const TOKEN = "0123456789abcdef0123456789abcdef";

const TICK = [100, 100, 200];

const listenButton = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

const thisDevice = (page: Page) =>
	page.getByRole("button", { name: /This device/ });

// The element is created by the store and never mounted in the tree.
const currentTime = (page: Page) =>
	page.evaluate(() => {
		const audio = document.querySelector("audio");
		return audio ? audio.currentTime : null;
	});

// The elapsed side of the status bar's `mm:ss/mm:ss` readout, in seconds.
const elapsedSeconds = async (page: Page) => {
	const text = (await statusBar(page).innerText()).replace(/\s+/g, " ");
	const match = /(\d+):(\d\d)\s*\/\s*\d+:\d\d/.exec(text);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const streamRequests = (player: FakePlayer) =>
	player.requests.filter((entry) => entry.path === "/api/stream");

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

// By the player's name rather than by its note: the note is the whole point of
// that row and says something different in every state it has.
const thePlayer = (page: Page) =>
	picker(page).getByRole("button", { name: /foobar2000/ });

test.describe("listening on this device", () => {
	test.use({ fooJean: {}, fooJeanToken: TOKEN });

	test("takes a ticket and opens the stream", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// One ticket per connect, not per request: Safari probes with a `Range`
		// before fetching for real, so a ticket good once could not serve it.
		await expect.poll(() => ticketRequests(player).length).toBe(1);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
	});

	test("asks for the format the server put first", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// The server's order is the quality order and the client only excludes, so
		// Chromium, which plays both, asks for the first. Read off the fake's own
		// log: `requests` records paths without their query.
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

	test("the toggle is this device's alone", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);
		await expect.poll(() => ticketRequests(player).length).toBe(1);

		// Nothing about listening may reach the player's own settings namespace.
		const written = requestsTo(player, "/api/clientconfig").filter(
			(entry) => entry.method === "POST",
		);
		expect(written).toEqual([]);
	});

	test("no ticket and no token appears in a URL", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);

		// The bearer token travels in a header and must never be in a query
		// string; the ticket is the credential that may be.
		for (const entry of player.requests)
			expect(entry.path).not.toContain(TOKEN);
		expect(page.url()).not.toContain(TOKEN);
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
		fooJeanToken: TOKEN,
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
		await expect.poll(() => ticketRequests(player).length).toBe(2);
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
		fooJeanToken: TOKEN,
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
	test.use({ fooJean: { canStream: false }, fooJeanToken: TOKEN });

	test("does not offer the control at all", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page).getByRole("button")).not.toHaveCount(0);
		// `canStream` absent or false means the button does not render.
		await expect(listenButton(page)).toHaveCount(0);
	});
});

test.describe("with no component at all", () => {
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
		fooJeanToken: TOKEN,
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
	test.use({ fooJean: { expireTickets: true }, fooJeanToken: TOKEN });

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
	test.use({ fooJean: { streamBehaviour: "short" }, fooJeanToken: TOKEN });

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
});

test.describe("a stream that goes quiet", () => {
	test.use({ fooJean: { streamBehaviour: "quiet" }, fooJeanToken: TOKEN });

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
	test.use({ fooJean: { streamPrime: 6 }, fooJeanToken: TOKEN });

	// Real time is the thing under test.
	test.setTimeout(120_000);

	test("stays on the track still coming out of the speaker", async ({
		page,
		player,
	}) => {
		await page.goto("/");
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
		).toBeVisible();

		await expect(statusBar(page)).toContainText(HEARD.title);
		await expect(statusBar(page)).not.toContainText(NEXT.title);

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
		await page.goto("/");
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
		await page.goto("/");
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

test.describe("who else is listening", () => {
	test.use({
		fooJean: {
			otherListeners: [
				{ deviceId: "phone-1", name: "Android phone", listeningFor: 240 },
				{ deviceId: "phone-2", name: "Android phone", listeningFor: 30 },
				{ deviceId: "laptop-1", name: null, listeningFor: 0 },
			],
		},
		fooJeanToken: TOKEN,
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
			"Muted while 3 devices are listening",
		);
	});

	test("asking for both outputs unmutes the player and does not stop anybody", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await listenButton(page).click();

		// Named for its target: the status bar's own mute button answers to
		// "Unmute" as well whenever the player is silent.
		await page.getByRole("button", { name: "Unmute foobar2000" }).click();

		await expect(picker(page)).toContainText("Where the player is");
		await expect(
			page.getByRole("button", { name: "Unmute foobar2000" }),
		).toHaveCount(0);

		// It adds an output rather than taking one away: everybody who was
		// listening still is.
		const roster = page.getByRole("list", { name: "Also listening" });
		await expect(roster.getByRole("listitem")).toHaveCount(3);

		// The preflight is a request too: this is a cross-origin call carrying a
		// bearer token, so every one of them is two entries.
		const released = requestsTo(player, "/api/stream/hold").filter(
			(entry) => entry.method === "DELETE",
		);
		expect(released.length).toBe(1);
	});
});

test.describe("saying goodbye", () => {
	test.use({ fooJean: {}, fooJeanToken: TOKEN });

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

		expect(
			requestsTo(player, "/api/stream/leave").filter(
				(entry) => entry.method === "POST",
			),
		).toEqual([]);
	});
});
