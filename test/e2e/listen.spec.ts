import {
	expect,
	type FakePlayer,
	type Page,
	requestsTo,
	statusBar,
	test,
} from "./fixtures.ts";

// Playwright cannot hear anything, so nothing here asserts on sound. What it
// asserts on is what went over the wire and what the element believes: which
// `?format=` was asked for, that exactly one ticket was fetched per connect, and
// that `currentTime` is advancing.

const TOKEN = "0123456789abcdef0123456789abcdef";

const TICK = [100, 100, 200];

const listenButton = (page: Page) =>
	statusBar(page).getByRole("button", {
		name: /Choose where to play|Playing on this device/,
	});

const thisDevice = (page: Page) =>
	page.getByRole("radio", { name: /This device/ });

// The element is created by the store and never mounted in the tree, so it is
// found through the store rather than through the DOM.
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

// Choosing does not dismiss the panel: the row you just picked is where the
// connection reports itself, so closing it would hide the only progress there
// is. Every helper below therefore leaves it open.
const startListening = async (page: Page) => {
	await listenButton(page).click();
	await thisDevice(page).click();
};

const picker = (page: Page) =>
	page.getByRole("radiogroup", { name: "Playing on" });

test.describe("listening on this device", () => {
	test.use({ fooJean: {}, fooJeanToken: TOKEN });

	test("takes a ticket and opens the stream", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// One ticket per connect. Not one per request: Safari probes with a
		// `Range` before fetching for real, so a ticket good once could not serve
		// it -- but a second *connect* must not reuse this one.
		await expect.poll(() => ticketRequests(player).length).toBe(1);
		await expect.poll(() => streamRequests(player).length).toBeGreaterThan(0);
	});

	test("asks for the format the server put first", async ({ page, player }) => {
		await page.goto("/");
		await startListening(page);

		// The server's order is the quality order and the client only excludes, so
		// Chromium -- which plays both -- must ask for the first. Read off the
		// fake's own log: `requests` records paths without their query, and this
		// is a claim about the query string.
		await expect.poll(() => player.streamFormats).toEqual(["opus"]);
	});

	test("advances the element's clock", async ({ page }) => {
		await page.goto("/");
		await startListening(page);

		// Polled tightly rather than on the default backoff: this is watching a
		// clock tick, so a poll that has already backed off to a second is a test
		// spending ten of them to observe half of one.
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

		await page.getByRole("radio", { name: /Where the player is/ }).click();

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
	// The component offers both; this browser is served bytes that are not the
	// declared type for the first one, which is what the fall-through is for.
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

test.describe("an install with no encoder", () => {
	test.use({ fooJean: { canStream: false }, fooJeanToken: TOKEN });

	test("does not offer the control at all", async ({ page }) => {
		await page.goto("/");
		await expect(statusBar(page).getByRole("button")).not.toHaveCount(0);
		// `canStream` absent or false means the button does not render. Offering
		// one and then failing is worse than never offering it.
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

		// A 401 on the stream is not an error the element can report as anything
		// but "cannot play this", so it falls through the formats and then keeps
		// asking -- each attempt with a ticket of its own.
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

		// The one case with no error to catch. The element never fires `playing`,
		// `currentTime` never moves, and only beefweb can say which of the two
		// this is -- so the watchdog asks it. The fake player is stopped, so it
		// must say so rather than blaming the network.
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
		// Two minutes in, so the audible point lands inside this track rather than
		// before anything the fake ever played.
		player.patchPlayer({ position: 120 });
		await expect(statusBar(page)).toContainText(HEARD.title);

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		// The desktop moves on, and beefweb says so at once.
		player.playItem("p7", NEXT.index);
		// Pushed straight after, and never delayed -- so the button flipping is
		// proof the app has the new track and is choosing not to draw it. An
		// ordering to assert on rather than a margin to guess.
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
		// timer, so its stored `position` stays where the last push left it while
		// the player it stands for goes on playing.
		const startedAt = Date.now();
		player.playItem("p7", HEARD.index);

		await startListening(page);
		await expect
			.poll(() => currentTime(page), { timeout: 60_000, intervals: TICK })
			.toBeGreaterThan(0);

		// The bound is wide because what is asserted is that a correction is applied
		// at all, and in the right direction. Its size is the browser's business,
		// and on the fake it comes to about six seconds.
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

		// Only the track is delayed. A control MUST move under the finger that
		// pressed it.
		await statusBar(page)
			.getByRole("button", { name: "Pause", exact: true })
			.click();
		await expect(
			statusBar(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	});
});
