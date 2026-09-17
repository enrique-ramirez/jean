import type { FakePlayer, Page } from "./fixtures.ts";
import {
	dragFrom,
	expect,
	expectSettlesAt,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSidebar,
	pressAndHold,
	requestsTo,
	sidebar,
	statusBar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

const queueButton = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^Queue/ });

const anyQueueButton = async (page: Page) => {
	if (await queueButton(page).count()) return queueButton(page);
	await openNowPlaying(page);
	return nowPlayingScreen(page).getByRole("button", { name: /^Queue/ });
};

// Closed, the panel is parked off the right edge rather than hidden, so
// `toBeHidden()` would not see it either way.
const openQueue = async (page: Page) => {
	if ((await queuePanel(page).getAttribute("data-open")) !== "true")
		(await anyQueueButton(page)).click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
};

const queueRows = (page: Page) => queuePanel(page).getByRole("listitem");

const queueTracks = async (page: Page, isMobile: boolean, index = 0) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	const item = page.getByRole("menuitem", { name: "Add to queue" });
	await expect(item).toBeEnabled();
	await item.click();
	await expect(item).toHaveCount(0);
};

const queuedTitles = (player: FakePlayer) =>
	player.playQueue.map((entry) => {
		const playlist = player.playlists.find(
			(entry_) => entry_.id === entry.playlistId,
		);
		return playlist?.items[entry.itemIndex]?.["%title%"] ?? "";
	});

// The route the holding playlist was made, filled and emptied through, back when
// a queue entry had to be a playlist and a row. The component has no such role
// any more, so every verb on it is a 400 and nothing here may go near it.
const askedForTheQueueRole = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.path === "/api/playlists/own/queue/items",
	);

// Every title in foobar2000's own playlist tabs, which is where a playlist Jean
// made for its own plumbing would show up.
const playlistTitles = (player: FakePlayer) =>
	player.playlists.map((entry) => entry.title);

// What `GET /api/queue` answers, read off the player rather than off the panel.
const queuedAtThePlayer = (player: FakePlayer) =>
	player.queuedEntries().map((entry) => ({
		title: String(entry.track["%title%"] ?? ""),
		artist: String(entry.track["%artist%"] ?? ""),
	}));

// Where each entry sits, as `GET /api/queue` reports it: a track queued by
// handle and a row whose playlist position the player has lost both answer with
// none. Read off the player to say the case is set up, never as the assertion.
const queuePositions = (player: FakePlayer) =>
	player
		.queuedEntries()
		.map((entry) =>
			entry.playlistId && entry.index >= 0 ? entry.index : null,
		);

const componentRequests = (player: FakePlayer, method: string, route: string) =>
	player.requests.filter(
		(entry) => entry.method === method && entry.path.split("?")[0] === route,
	);

// The one route addressed by a queue index rather than by a body.
const componentRemovals = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "DELETE" && /^\/api\/queue\/\d+/.test(entry.path),
	);

// Either way the queue can be emptied of a playlist: entry by entry, or whole.
const emptiesTheQueue = (entry: { method: string; path: string }) =>
	entry.method === "DELETE" && /^\/api\/queue(\/\d+)?(\?|$)/.test(entry.path);

// beefweb's own queue surface: the four routes it publishes and the read that
// carries the queue on a query. The long-lived update subscription is a path of
// its own and is not one of these.
const beefwebQueueRequests = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.path.startsWith("/api/playqueue") ||
			(entry.path.startsWith("/api/query?") &&
				entry.path.includes("playQueue=true")),
	);

const forgetRequests = (player: FakePlayer) => {
	player.requests.length = 0;
};

const trackOfPlaylist = (
	player: FakePlayer,
	playlistId: string,
	index: number,
) => {
	const playlist = player.playlists.find((entry) => entry.id === playlistId);
	if (!playlist) throw new Error(`no playlist ${playlistId}`);
	const track = playlist.items[index];
	if (!track) throw new Error(`no row ${index} in ${playlistId}`);
	return track;
};

// Somebody at the desktop pressing Add to playback queue: a playlist row, which
// the player holds with the position it came from.
const rowQueuedAtThePlayer = (
	player: FakePlayer,
	playlistId: string,
	index: number,
	at?: number,
) => {
	const track = trackOfPlaylist(player, playlistId, index);
	player.queueInsert([{ playlistId, track }], at);
	return String(track["%title%"] ?? "");
};

// The same press on a library track with no playlist open: the player holds the
// handle alone, and there is no position for beefweb to name it by.
const trackQueuedAtThePlayer = (player: FakePlayer, ordinal: number) => {
	const { track } = player.ordinalOrder()[ordinal];
	player.queueInsert([{ playlistId: null, track }]);
	return String(track["%title%"] ?? "");
};

const dragRow = async (page: Page, from: number, to: number) => {
	const start = (await queueRows(page).nth(from).boundingBox())!;
	const end = (await queueRows(page).nth(to).boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		end.x + end.width / 2,
		end.y + end.height * (to < from ? 0.25 : 0.75),
		{ steps: 12 },
	);
	await page.mouse.up();
};

test.describe("putting things in the queue", () => {
	test("a track queued from the list reaches the player", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile);

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);
		expect(player.playQueue[0].playlistId).toBe("p7");
	});

	// A selection queued row by row can be left half queued, and one queued as a
	// range comes back in the player's order rather than the one clicked.
	test("a whole selection is queued in one request, in the order chosen", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);

		const chosen = player.playlists
			.find((entry) => entry.id === "p7")
			?.items.slice(0, 3)
			.map((track) => String(track["%title%"] ?? ""));

		if (isMobile) {
			await queueTracks(page, isMobile, 0);
			await queueTracks(page, isMobile, 1);
			await queueTracks(page, isMobile, 2);
		} else {
			await trackRow(page, 0).click();
			await trackRow(page, 2).click({ modifiers: ["Shift"] });
			await queueTracks(page, isMobile, 1);
		}

		await expect
			.poll(() => queuedAtThePlayer(player).map((entry) => entry.title), {
				timeout: 5000,
			})
			.toEqual(chosen);

		// One press, one request. A phone has no range to select, so it is three
		// presses and three requests there.
		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue").length,
			isMobile ? 3 : 1,
		);
	});

	test("a track dropped on the queue button is queued", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);

		const source = await trackRow(page, 0).boundingBox();
		const drop = await queueButton(page).boundingBox();

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			drop!.x + drop!.width / 2,
			drop!.y + drop!.height / 2,
			{ steps: 16 },
		);

		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
		await expect(queueRows(page)).toHaveCount(1);
		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue").length,
			1,
		);
		expect(queuedAtThePlayer(player)).toHaveLength(1);
	});

	test("a track dropped into the panel lands where the line was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await expect(queueRows(page)).toHaveCount(2);
		const before = queuedAtThePlayer(player).map((entry) => entry.title);

		const source = await trackRow(page, 0).boundingBox();
		// A row's id carries its index, but the drop line above a row and the
		// row itself are two separate targets sharing that id -- aiming at the
		// row's upper half, not its middle, is what lands on the line above it.
		const first = (await queueRows(page).first().boundingBox())!;

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(first.x + first.width / 2, first.y + 4, {
			steps: 16,
		});
		await expect(queueRows(page).first()).toHaveAttribute(
			"data-drop-line",
			"true",
		);
		await page.mouse.up();

		await expect
			.poll(
				() =>
					queuedAtThePlayer(player)
						.map((entry) => entry.title)
						.slice(1),
				{ timeout: 10_000 },
			)
			.toEqual(before);
		await expect(queueRows(page)).toHaveCount(3);
	});

	test("a drop below the last row appends, leaving what was queued where it was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);
		await queueTracks(page, isMobile, 1);
		await expect(queueRows(page)).toHaveCount(1);

		const rows = player.playlists.find((entry) => entry.id === "p7")?.items;
		const held = String(rows?.[1]["%title%"] ?? "");
		const dropped = String(rows?.[0]["%title%"] ?? "");

		const source = await trackRow(page, 0).boundingBox();
		const panel = (await queuePanel(page).boundingBox())!;

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			panel.x + panel.width / 2,
			panel.y + panel.height - 40,
			{ steps: 16 },
		);
		await page.mouse.up();

		await expect
			.poll(() => queuedAtThePlayer(player).map((entry) => entry.title), {
				timeout: 5000,
			})
			.toEqual([held, dropped]);
		// The end is the one place a queue change needs no plan, so nothing comes
		// off to make room.
		expect(componentRemovals(player)).toHaveLength(0);
	});

	test("the button announces itself only while a drag is in flight", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);

		await expect(queueButton(page)).not.toHaveAttribute("data-drop-target");

		const source = await trackRow(page, 0).boundingBox();
		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(source!.x + 90, source!.y + 40, { steps: 8 });

		await expect(queueButton(page)).toHaveAttribute("data-drop-target");
		await expect(queueButton(page)).not.toHaveAttribute("data-drop-over");

		await page.mouse.up();
		await expect(queueButton(page)).not.toHaveAttribute("data-drop-target");
	});

	test("the drop is caught outside the button, but only mid-drag", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);

		const source = await trackRow(page, 0).boundingBox();
		const drop = await queueButton(page).boundingBox();
		const beside = { x: drop!.x - 6, y: drop!.y + drop!.height / 2 };

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(beside.x, beside.y, { steps: 16 });
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		const stillCaught = await page.evaluate(
			(point) =>
				Boolean(
					document
						.elementFromPoint(point.x, point.y)
						?.closest('button[aria-label^="Queue"]'),
				),
			beside,
		);
		expect(stillCaught).toBe(false);
	});

	test("the button sits with the transport, after Next", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "there is no Next button on a compact viewport");
		await openLibrary(page);

		const boxOf = async (name: string | RegExp) =>
			(await statusBar(page).getByRole("button", { name }).boundingBox())!;
		const next = await boxOf("Next track");
		const queue = await boxOf(/^Queue/);

		expect(queue.x).toBeGreaterThan(next.x);
		expect(Math.abs(queue.y - next.y)).toBeLessThan(queue.height);
	});

	test("on a phone it sits with the transport too, beside Shuffle", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the desktop transport is the status bar, tested above",
		);
		await openLibrary(page);
		await openNowPlaying(page);

		// Not the header: the top of a screen this tall is nowhere near a thumb, and the queue is a thing you press while listening.
		await expect(
			nowPlayingScreen(page)
				.locator("header")
				.getByRole("button", { name: /^Queue/ }),
		).toHaveCount(0);

		const boxOf = async (name: string | RegExp) =>
			(await nowPlayingScreen(page)
				.getByRole("button", { name })
				.boundingBox())!;
		const shuffle = await boxOf("Shuffle");
		const queue = await boxOf(/^Queue/);

		expect(queue.x).toBeGreaterThan(shuffle.x);
		expect(Math.abs(queue.y - shuffle.y)).toBeLessThan(queue.height);
	});

	test("the badge counts what is queued", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);

		const badge = async () => {
			const button = await anyQueueButton(page);
			const name = await button.getAttribute("aria-label");
			const text = (await button.textContent()) ?? "";
			if (isMobile) {
				await nowPlayingScreen(page)
					.getByRole("button", { name: "Close now playing" })
					.click();
				await expect(nowPlayingScreen(page)).toBeHidden();
			}
			return { name, text };
		};

		expect((await badge()).name).toBe("Queue");

		await queueTracks(page, isMobile);
		expect(await badge()).toMatchObject({ name: "Queue, 1 track", text: "1" });

		await queueTracks(page, isMobile, 1);
		expect((await badge()).name).toBe("Queue, 2 tracks");
		expect(player.playQueue).toHaveLength(2);
	});
});

test.describe("queueing opens the panel", () => {
	test("and that is the whole of what it says about it", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile);

		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
		await expect(queueRows(page)).toHaveCount(1);
		await expect(page.getByRole("status")).toHaveCount(0);
	});

	test("a press outside puts away the overlay and leaves the dock", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		const box = (await queuePanel(page).boundingBox())!;
		await page.mouse.click(box.x / 2, box.y + 120);

		await expect(queuePanel(page)).toHaveAttribute(
			"data-open",
			isMobile ? "false" : "true",
		);
	});

	test("the button that opened it still closes it", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		(await anyQueueButton(page)).click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
	});

	test("but a row dragged by its grip is not a flick", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the grip is the coarse-pointer path");
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await expect(queueRows(page)).toHaveCount(2);

		const grip = queueRows(page)
			.first()
			.getByRole("button", { name: /^Reorder/ });
		const box = (await grip.boundingBox())!;
		const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		// Down the panel, as a reorder is, but drifting further sideways than a flick is read at: that is what `data-owns-touch` is for, since the grip owns the gesture on both axes once it has it.
		await touchDrag(page, from, { x: from.x + 120, y: from.y + 60 }, 8);

		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
	});

	test("Escape closes it, and the screen under it keeps the next one", async ({
		page,
	}) => {
		await openLibrary(page);
		await openNowPlaying(page);
		await (await anyQueueButton(page)).click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		// A capture listener does not stop its siblings on `window`, so both layers would answer this one keystroke unless the screen stands down for the panel.
		await page.keyboard.press("Escape");
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
		await expect(nowPlayingScreen(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();
	});

	test("and Escape reaches the selection behind once it is closed", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "selecting rows is a pointer path");
		await openLibrary(page);

		await trackRow(page, 2).click();
		await expect(trackRow(page, 2)).toHaveAttribute("aria-selected", "true");

		await (await anyQueueButton(page)).click();
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		// The panel is in front, so the first press is spent on it and the selection is still there to drop with the second.
		await page.keyboard.press("Escape");
		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
		await expect(trackRow(page, 2)).toHaveAttribute("aria-selected", "true");

		await page.keyboard.press("Escape");
		await expect(trackRow(page, 2)).toHaveAttribute("aria-selected", "false");
	});

	test("a flick to the right puts it away", async ({ page, isMobile }) => {
		test.skip(!isMobile, "a flick is a touch gesture");
		await openLibrary(page);
		await queueTracks(page, isMobile);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		// Begun inside the left edge of the panel, so the whole 160px lands on it rather than off the right of the viewport.
		const box = (await queuePanel(page).boundingBox())!;
		const from = { x: box.x + 40, y: box.y + box.height / 2 };
		await touchDrag(page, from, { x: from.x + 160, y: from.y });

		await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
	});

	test("but a flick up or down is the scroller's", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "a flick is a touch gesture");
		await openLibrary(page);

		await queueTracks(page, isMobile);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

		for (const [dy, name] of [
			[-160, "up"],
			[160, "down"],
		] as const) {
			const box = (await queuePanel(page).boundingBox())!;
			const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			await touchDrag(page, from, { x: from.x, y: from.y + dy });

			await expect(
				queuePanel(page),
				`a flick ${name} closed it`,
			).toHaveAttribute("data-open", "true");
		}
	});
});

test.describe("the panel", () => {
	test("opens empty, and says so rather than looking broken", async ({
		page,
	}) => {
		await openLibrary(page);
		await openQueue(page);

		await expect(queuePanel(page)).toContainText("The queue is empty");
		await expect(queuePanel(page)).toContainText("Nothing queued");
		await expect(queueRows(page)).toHaveCount(0);
	});

	test("opens over the list rather than shouldering it aside", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "there is nothing beside it to push on a phone");
		await openLibrary(page);

		const width = () =>
			page.locator("main").evaluate((el) => Math.round(el.clientWidth));
		const before = await width();

		await openQueue(page);
		expect(await width()).toBe(before);
	});

	test("lists what was queued, in the order it was queued", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);

		await expect(queueRows(page)).toHaveCount(2);

		const shown = await queueRows(page).evaluateAll((rows) =>
			rows.map((row) => row.textContent ?? ""),
		);
		const queued = queuedTitles(player);
		expect(shown[0]).toContain(queued[0]);
		expect(shown[1]).toContain(queued[1]);
	});

	test("a row says when it will play", async ({ page, player, isMobile }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.playbackState, { timeout: 5000 })
			.toBe("playing");

		await queueTracks(page, isMobile, 5);
		await openQueue(page);

		await expect(queueRows(page).first()).toContainText(/in \d+:\d\d/);
		await expect(queuePanel(page)).toContainText(/left of this track/);
	});

	test("the head of the rail counts down, with nothing queued behind it", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.playbackState, { timeout: 5000 })
			.toBe("playing");

		await openQueue(page);

		const label = queuePanel(page).getByText(/left of this track/);
		const first = await label.textContent();
		await expect
			.poll(() => label.textContent(), { timeout: 5000 })
			.not.toBe(first);
	});

	// `movePlan` rebuilds the tail rather than inserting, because `queueIndex` on
	// `/playqueue/add` is accepted and silently ignored. Nothing exercised it, and
	// dragging a queued track up the list is an ordinary thing to want.
	test("dragging a row up the list moves it on the player", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the grip is a separate gesture; see below");

		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(3);

		const before = queuedTitles(player);
		const from = (await queueRows(page).nth(2).boundingBox())!;
		const to = (await queueRows(page).nth(0).boundingBox())!;

		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, {
			steps: 12,
		});
		await page.mouse.up();

		await expect
			.poll(() => queuedTitles(player), { timeout: 10_000 })
			.toEqual([before[2], before[0], before[1]]);
		await expect(queueRows(page)).toHaveCount(3);
	});

	test("the reorder leaves the queue the same length it was", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the grip is a separate gesture; see below");

		// A rebuild removes from the earlier of the two positions down and adds the
		// tail back. Off by one either way and the queue grows or loses a track,
		// which the order assertion above cannot see on its own.
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);

		const before = queuedTitles(player);
		const from = (await queueRows(page).nth(0).boundingBox())!;
		const to = (await queueRows(page).nth(2).boundingBox())!;

		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.75, {
			steps: 12,
		});
		await page.mouse.up();

		await expect
			.poll(() => queuedTitles(player), { timeout: 10_000 })
			.toEqual([before[1], before[2], before[0]]);
		await expectSettlesAt(player, () => player.playQueue.length, 3);
	});

	test("a finger reorders through the grip, which is the only thing that can", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(!isMobile, "the grip is drawn for coarse pointers only");
		test.fixme(
			true,
			"the grip inherits touch-action: pan-y from the panel, so the browser reads the finger as a scroll and cancels the pointer stream two moves in",
		);

		// The vertical axis belongs to the scroller and the hold-then-drag gesture
		// is spent on the context menu, so nothing but an explicit handle can claim
		// a reorder here.
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(3);

		const before = queuedTitles(player);
		const grip = queuePanel(page)
			.getByRole("button", { name: /^Reorder / })
			.first();
		const from = (await grip.boundingBox())!;
		const to = (await queueRows(page).nth(2).boundingBox())!;

		await touchDrag(
			page,
			{ x: from.x + from.width / 2, y: from.y + from.height / 2 },
			{ x: from.x + from.width / 2, y: to.y + to.height * 0.75 },
			10,
		);

		await expect
			.poll(() => queuedTitles(player), { timeout: 10_000 })
			.toEqual([before[1], before[2], before[0]]);
	});

	test("removing a row takes exactly that row off the player", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(3);

		const before = queuedAtThePlayer(player).map((entry) => entry.title);
		await queueRows(page)
			.nth(1)
			.getByRole("button", { name: /^Remove/ })
			.click();

		await expect(queueRows(page)).toHaveCount(2);
		await expect
			.poll(() => queuedAtThePlayer(player).map((entry) => entry.title), {
				timeout: 5000,
			})
			.toEqual([before[0], before[2]]);

		// Addressed by the queue position the user pressed, which is the whole of
		// what identifies an entry: the same track can be queued twice.
		const removals = componentRemovals(player);
		expect(removals).toHaveLength(1);
		expect(removals[0].path.split("?")[0]).toBe("/api/queue/1");
	});

	test("Clear empties it in one request", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);

		await queuePanel(page).getByRole("button", { name: "Clear" }).click();

		await expect(queueRows(page)).toHaveCount(0);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 5000 })
			.toBe(0);
		expect(componentRequests(player, "DELETE", "/api/queue")).toHaveLength(1);
	});
});

test.describe("what the player does with it", () => {
	test("a queued track leaves the queue when it starts", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.playbackState, { timeout: 5000 })
			.toBe("playing");

		await queueTracks(page, isMobile, 9);
		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);

		await page.evaluate(() => fetch("/api/player/next", { method: "POST" }));

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(0);
		expect(player.player.activeItem.index).toBe(9);
	});

	test("an entry follows its track when rows above it are removed", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 4);
		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);

		const [queued] = queuedTitles(player);
		expect(player.playQueue[0].itemIndex).toBe(4);

		await page.evaluate(() =>
			fetch("/api/playlists/p7/items/remove", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ items: [0] }),
			}),
		);

		await expect
			.poll(() => player.playQueue[0]?.itemIndex, { timeout: 5000 })
			.toBe(3);
		expect(queuedTitles(player)).toEqual([queued]);
	});
});

test.describe("deleting a playlist the queue points into", () => {
	test("clears the queue of it before sending the delete", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/#/p2");
		await expect(
			page.getByRole("heading", { level: 1, name: "Favorites" }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();

		await queueTracks(page, isMobile, 0);
		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);

		await openSidebar(page);
		const favorites = sidebar(page)
			.locator("> div")
			.filter({ hasText: "Favorites" });
		if (isMobile) await pressAndHold(page, favorites);
		else await favorites.click({ button: "right" });

		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect
			.poll(() => player.playlists.some((entry) => entry.id === "p2"), {
				timeout: 5000,
			})
			.toBe(false);

		// Deleting a playlist the queue points into crashes foo_beefweb and takes
		// foobar2000 with it, so the order of these two is the assertion. The
		// queue is emptied of the playlist at the component; the delete itself is
		// still beefweb's.
		const order = player.requests.filter(
			(entry) =>
				emptiesTheQueue(entry) || entry.path.includes("/playlists/remove/p2"),
		);

		expect(
			order.length,
			"the queue was never emptied of the playlist at the component",
		).toBeGreaterThan(1);
		expect(order.at(-1)?.path).toContain("/playlists/remove/p2");
		expect(
			order.slice(0, -1).every((entry) => entry.path.startsWith("/api/queue")),
		).toBe(true);
		expect(queuedAtThePlayer(player)).toHaveLength(0);
	});
});

test.describe("queueing a row that is in no playlist", () => {
	test.use({ mediaLibrarySize: 400 });

	test("queues it at the component alone, leaving the player no playlist to show for it", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		const before = playlistTitles(player);

		await queueTracks(page, isMobile, 2);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(1);

		const [queued] = queuedAtThePlayer(player);
		expect(queued.title).toBeTruthy();
		await expect(trackRow(page, 2)).toContainText(queued.title);
		await expect(queueRows(page).first()).toContainText(queued.title);

		expect(playlistTitles(player)).toEqual(before);
		await expectSettlesAt(player, () => askedForTheQueueRole(player).length, 0);
	});

	// The holding playlist was emptied on the next queue after the play queue had
	// drained, never on the first, so a drain and a second queue is the one path
	// the case above cannot reach.
	test("queues again once the queue has drained, with no holding playlist to empty first", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		const before = playlistTitles(player);

		await queueTracks(page, isMobile, 1);
		await expect(queueRows(page)).toHaveCount(1);

		await queuePanel(page).getByRole("button", { name: "Clear" }).click();
		await expect(queueRows(page)).toHaveCount(0);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 5000 })
			.toBe(0);

		await queueTracks(page, isMobile, 4);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(1);

		const [queued] = queuedAtThePlayer(player);
		await expect(trackRow(page, 4)).toContainText(queued.title);

		expect(playlistTitles(player)).toEqual(before);
		await expectSettlesAt(player, () => askedForTheQueueRole(player).length, 0);
	});

	test("a second row lands behind the first rather than rebuilding the queue", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);

		await queueTracks(page, isMobile, 1);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(1);
		const [first] = queuedAtThePlayer(player);

		await queueTracks(page, isMobile, 4);
		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(2);

		expect(queuedAtThePlayer(player)[0]).toEqual(first);
		await expect(trackRow(page, 4)).toContainText(
			queuedAtThePlayer(player)[1].title,
		);
		await expectSettlesAt(
			player,
			() => player.requests.filter(emptiesTheQueue).length,
			0,
		);
	});
});

// Written out rather than imported: a test that read the constant would agree
// with whatever the constant was changed to. Grouping the thousand is the
// formatter's business, so either spelling passes.
const namesTheLimit = /1,?000/;

// A selection this size takes Mod+A, so the limit is a desktop affair: a phone
// queues a row at a time and never builds one that reaches it.
const selectEveryTrack = async (page: Page) => {
	await openAllMusic(page);
	await page.keyboard.press("ControlOrMeta+a");
};

const queueMenuItem = async (page: Page) => {
	await trackRow(page, 0).click({ button: "right" });
	return page.getByRole("menuitem", { name: "Add to queue" });
};

test.describe("a selection of a thousand tracks", () => {
	test.use({ mediaLibrarySize: 1000 });
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("is queued whole, in one request", async ({ page, player }) => {
		await selectEveryTrack(page);
		await queueTracks(page, false);

		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 30_000 })
			.toBe(1000);
		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue").length,
			1,
		);
	});
});

test.describe("a selection past a thousand tracks", () => {
	test.use({ mediaLibrarySize: 1001 });
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("is refused by the menu item, which names the limit in its own label", async ({
		page,
	}) => {
		await selectEveryTrack(page);
		const item = await queueMenuItem(page);

		await expect(item).toBeDisabled();
		await expect(item).toHaveAccessibleName(namesTheLimit);
	});

	test("dropped on the queue button, names the limit and queues nothing", async ({
		page,
		player,
	}) => {
		await selectEveryTrack(page);

		await dragFrom(page, trackRow(page, 0), queueButton(page));
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect(page.getByRole("status")).toContainText(namesTheLimit);
		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue").length,
			0,
		);
		expect(queuedAtThePlayer(player)).toHaveLength(0);
	});
});

const expectQueueTakesALibraryRow = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
) => {
	await openAllMusic(page);
	await queueTracks(page, isMobile, 2);

	await expect
		.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
		.toBe(1);
	const [queued] = queuedAtThePlayer(player);
	expect(queued.title).toBeTruthy();
	await expect(trackRow(page, 2)).toContainText(queued.title);
	await expect(queueRows(page)).toHaveCount(1);

	// The fake honours no beefweb permission, so a queued track is not on its own
	// proof that Jean stopped asking beefweb for the playlist to queue it through.
	await expectSettlesAt(
		player,
		() => requestsTo(player, "/playlists/add").length,
		0,
	);
};

test.describe("a player that will not let Jean make playlists", () => {
	test.use({
		playerState: {
			permissions: {
				changePlaylists: false,
				changeOutput: true,
				changeClientConfig: true,
			},
		},
	});

	test("queues a library row all the same", async ({
		page,
		player,
		isMobile,
	}) => {
		await expectQueueTakesALibraryRow(page, player, isMobile);
	});

	// The menu and the drag are two surfaces and they are gated separately.
	// Queueing a library row writes through the component rather than through
	// beefweb, so what beefweb permits is not a reason for either one to refuse.
	test("queues a library row dragged onto the queue", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openAllMusic(page);
		await expect(trackRow(page, 2)).toBeVisible();

		await dragFrom(page, trackRow(page, 2), queueButton(page));
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(1);
		const [queued] = queuedAtThePlayer(player);
		expect(queued.title).toBeTruthy();
		await expect(trackRow(page, 2)).toContainText(queued.title);
		await expect(queueRows(page)).toHaveCount(1);
	});

	test.describe("with the component's own playlist writes turned off too", () => {
		test.use({ fooJean: { canWritePlaylists: false } });

		// Neither setting has anything to say about a queue: the row is queued by
		// its handle, and no playlist of anybody's is written to on the way.
		test("queues a library row all the same", async ({
			page,
			player,
			isMobile,
		}) => {
			await expectQueueTakesALibraryRow(page, player, isMobile);
		});
	});
});

test.describe("the queue is the component's", () => {
	test("draws the entries the component answers, in its order, and reads none of it from beefweb", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 3);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);

		await expect(queueRows(page)).toHaveCount(2);

		const answered = queuedAtThePlayer(player);
		const shown = await queueRows(page).evaluateAll((rows) =>
			rows.map((row) => row.textContent ?? ""),
		);
		expect(shown[0]).toContain(answered[0].title);
		expect(shown[0]).toContain(answered[0].artist);
		expect(shown[1]).toContain(answered[1].title);
		expect(shown[1]).toContain(answered[1].artist);

		expect(
			componentRequests(player, "GET", "/api/queue").length,
			"the panel drew a queue it never read from the component",
		).toBeGreaterThan(0);
		await expectSettlesAt(player, () => beefwebQueueRequests(player).length, 0);
	});

	test("picks up a track queued at the player, with no reload", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await openQueue(page);
		await expect(queuePanel(page)).toContainText("The queue is empty");

		const title = trackQueuedAtThePlayer(player, 7);

		await expect(queueRows(page)).toHaveCount(1);
		await expect(queueRows(page).first()).toContainText(title);
	});

	test("queues a track with one request to the component, and none to beefweb", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		forgetRequests(player);

		await queueTracks(page, isMobile, 2);
		await expect(queueRows(page)).toHaveCount(1);

		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue").length,
			1,
		);
		expect(queuedAtThePlayer(player)).toHaveLength(1);
		expect(beefwebQueueRequests(player)).toHaveLength(0);
	});

	test("moves an entry with one request to the component, and none to beefweb", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the grip is a separate gesture; see above");

		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(3);

		const before = queuedAtThePlayer(player);
		forgetRequests(player);

		await dragRow(page, 2, 0);

		await expect
			.poll(() => queuedAtThePlayer(player), { timeout: 10_000 })
			.toEqual([before[2], before[0], before[1]]);
		await expectSettlesAt(
			player,
			() => componentRequests(player, "POST", "/api/queue/move").length,
			1,
		);
		expect(beefwebQueueRequests(player)).toHaveLength(0);
	});

	test("removes an entry with one request to the component, and none to beefweb", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(2);

		const before = queuedAtThePlayer(player);
		forgetRequests(player);

		await queueRows(page)
			.first()
			.getByRole("button", { name: /^Remove/ })
			.click();

		await expect
			.poll(() => queuedAtThePlayer(player), { timeout: 10_000 })
			.toEqual([before[1]]);
		await expectSettlesAt(player, () => componentRemovals(player).length, 1);
		expect(beefwebQueueRequests(player)).toHaveLength(0);
	});

	test("clears the queue with one request to the component, and none to beefweb", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(2);

		forgetRequests(player);
		await queuePanel(page).getByRole("button", { name: "Clear" }).click();

		await expect(queueRows(page)).toHaveCount(0);
		await expectSettlesAt(
			player,
			() => componentRequests(player, "DELETE", "/api/queue").length,
			1,
		);
		// The panel empties before the request goes out, so the count on its own
		// would pass against a clear the player refused.
		expect(queuedAtThePlayer(player)).toHaveLength(0);
		expect(beefwebQueueRequests(player)).toHaveLength(0);
	});

	test("a move the component refuses leaves the panel on the player's own queue", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the grip is a separate gesture; see above");

		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await queueTracks(page, isMobile, 2);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(3);
		const before = queuedAtThePlayer(player);

		// The poll is what carries a queue change back, so cutting it off is what
		// leaves a drag planned against a queue the player has already moved past.
		player.fooJean.failState = 503;
		const queuedFirst = rowQueuedAtThePlayer(player, "p2", 0, 0);

		await dragRow(page, 2, 0);

		player.fooJean.failState = null;

		await expectSettlesAt(player, () => queuedAtThePlayer(player).length, 4);
		expect(queuedAtThePlayer(player).map((entry) => entry.title)).toEqual([
			queuedFirst,
			...before.map((entry) => entry.title),
		]);

		await expect(queueRows(page)).toHaveCount(4);
		const shown = await queueRows(page).evaluateAll((rows) =>
			rows.map((row) => row.textContent ?? ""),
		);
		expect(shown[0]).toContain(queuedFirst);
		expect(shown[3]).toContain(before[2].title);
	});

	test("a remove the component refuses leaves the panel on the player's own queue", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await queueTracks(page, isMobile, 0);
		await queueTracks(page, isMobile, 1);
		await openQueue(page);
		await expect(queueRows(page)).toHaveCount(2);
		const before = queuedAtThePlayer(player);

		player.fooJean.failState = 503;
		const queuedFirst = rowQueuedAtThePlayer(player, "p2", 0, 0);

		await queueRows(page)
			.first()
			.getByRole("button", { name: /^Remove/ })
			.click();

		player.fooJean.failState = null;

		await expectSettlesAt(player, () => queuedAtThePlayer(player).length, 3);
		expect(queuedAtThePlayer(player).map((entry) => entry.title)).toEqual([
			queuedFirst,
			...before.map((entry) => entry.title),
		]);

		await expect(queueRows(page)).toHaveCount(3);
		await expect(queueRows(page).first()).toContainText(queuedFirst);
	});
});

// The player plays an entry it has no position for, whether the row it was
// queued from was removed or its whole playlist went, so there is nothing for
// the panel to warn anybody about: it is an ordinary row like the rest.
test.describe("an entry the player has no position for", () => {
	test("a track queued with no playlist row draws its own title and artist, and counts in the total", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await openQueue(page);

		rowQueuedAtThePlayer(player, "p2", 0);
		trackQueuedAtThePlayer(player, 5);

		await expect(queueRows(page)).toHaveCount(2);
		expect(
			queuePositions(player),
			"the second entry was queued with a position, so the case is not set up",
		).toEqual([0, null]);

		const answered = queuedAtThePlayer(player);
		await expect(queueRows(page).nth(1)).toContainText(answered[1].title);
		await expect(queueRows(page).nth(1)).toContainText(answered[1].artist);
		await expect(queuePanel(page)).not.toContainText(/skipped/i);
		await expect(queuePanel(page)).toContainText("2 tracks");
	});

	test("a queued row keeps its title and artist when the player loses its position, and still removes", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await openQueue(page);

		rowQueuedAtThePlayer(player, "p2", 1);
		await expect(queueRows(page)).toHaveCount(1);
		const [answered] = queuedAtThePlayer(player);

		// The desktop taking the row out from under an entry already in the queue.
		player.removeItems("p2", [1]);
		// Queued after the removal, so the read that draws this row is a read taken
		// with the first entry's position already gone.
		const marker = rowQueuedAtThePlayer(player, "p2", 0);
		expect(queuePositions(player)).toEqual([null, 0]);

		await expect(queueRows(page)).toHaveCount(2);
		await expect(queueRows(page).nth(1)).toContainText(marker);
		await expect(queueRows(page).first()).toContainText(answered.title);
		await expect(queueRows(page).first()).toContainText(answered.artist);
		await expect(queuePanel(page)).not.toContainText(/skipped/i);

		await queueRows(page)
			.first()
			.getByRole("button", { name: /^Remove/ })
			.click();

		await expect
			.poll(() => queuedAtThePlayer(player).map((entry) => entry.title))
			.toEqual([marker]);
		await expect(queueRows(page)).toHaveCount(1);
	});
});

const coverOfRow = (page: Page, at: number) =>
	queueRows(page).nth(at).locator("[data-artwork]");

// beefweb addresses a cover by a playlist and a row, which is what the pattern
// says and what keeps its other two artwork routes out. GETs alone, since a
// preflight fetches no picture.
const beefwebCovers = (player: FakePlayer) =>
	player.requests
		.filter((entry) => entry.method === "GET")
		.map((entry) => entry.path)
		.filter((path) => /^\/api\/artwork\/[^/?]+\/\d+$/.test(path));

// A positional cover asked for at a playlist beefweb does not publish. A GUID,
// an `undefined` or a playlist index standing in for an id all land here.
const coversAtNoPlaylist = (player: FakePlayer) =>
	beefwebCovers(player).filter(
		(path) =>
			!player.playlists.some((playlist) =>
				path.startsWith(`/api/artwork/${playlist.id}/`),
			),
	);

// The component addresses a cover by the track's library path, so this is the
// track each request named.
const componentCovers = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.startsWith("/api/artwork?"),
		)
		.map(
			(entry) =>
				new URLSearchParams(entry.path.slice(entry.path.indexOf("?"))).get(
					"track",
				) ?? "",
		);

const libraryPathOfQueued = (player: FakePlayer, at: number) => {
	const entry = player.queuedEntries()[at];
	if (!entry) throw new Error(`nothing queued at ${at}`);
	return player.libraryPathFor(entry.track);
};

// One of two addresses, or none. A queued row outlives the playlist position it
// was queued from, so the library path is the address that keeps working and it
// is the one taken first.
test.describe("the cover on a queued row", () => {
	test("comes from the component, addressed by the track's library path", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await openQueue(page);

		// Queued from a playlist other than the one on screen, so beefweb's
		// positional address for this row is asked for by nothing else here.
		rowQueuedAtThePlayer(player, "p2", 0);
		await expect(queueRows(page)).toHaveCount(1);

		const path = libraryPathOfQueued(player, 0);
		expect(
			path,
			"the media library does not carry this track, so the case is not set up",
		).toBeTruthy();
		expect(
			queuePositions(player),
			"the entry carries no position, so it cannot show which address wins",
		).toEqual([0]);

		await expect(coverOfRow(page, 0)).toHaveAttribute("data-artwork", "ok", {
			timeout: 15_000,
		});
		expect(componentCovers(player)).toContain(path);
		await expectSettlesAt(
			player,
			() =>
				beefwebCovers(player).filter((asked) =>
					asked.startsWith("/api/artwork/p2/"),
				).length,
			0,
		);
	});

	// A file in a playlist that the media library has never seen: foobar2000
	// queues it, the component has no library path to name it by, and beefweb's
	// positional address is what is left.
	test.describe("for a track the media library does not carry", () => {
		test.use({ mediaLibrarySize: 12 });

		test("comes from beefweb, at the beefweb id of the playlist it was queued from", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await openQueue(page);

			rowQueuedAtThePlayer(player, "p2", 0);
			await expect(queueRows(page)).toHaveCount(1);
			expect(
				libraryPathOfQueued(player, 0),
				"the media library carries this track, so the case is not set up",
			).toBeNull();

			await expect(coverOfRow(page, 0)).toHaveAttribute("data-artwork", "ok", {
				timeout: 15_000,
			});
			expect(beefwebCovers(player)).toContain("/api/artwork/p2/0");
			expect(coversAtNoPlaylist(player)).toEqual([]);
		});

		test("is a glyph where the player has neither a path nor a row for it", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await openQueue(page);

			// The desktop queueing a file it has open and never added to the
			// library: no library path, and no playlist row either.
			const track = trackOfPlaylist(player, "p2", 0);
			player.queueInsert([{ playlistId: null, track }]);

			await expect(queueRows(page)).toHaveCount(1);
			expect(queuePositions(player)).toEqual([null]);
			expect(libraryPathOfQueued(player, 0)).toBeNull();

			await expectSettlesAt(player, () => coversAtNoPlaylist(player).length, 0);
			expect(componentCovers(player)).not.toContain("");
			expect(componentCovers(player)).not.toContain(String(track["%path%"]));

			await expect(coverOfRow(page, 0).locator("svg")).toBeVisible();
			await expect(coverOfRow(page, 0).locator("img")).toHaveCount(0);
		});

		test("waits for the playlist join rather than asking at an address it cannot build yet", async ({
			page,
			player,
			baseURL,
		}) => {
			// `GET /api/playlists` at the component is the join, and until it
			// answers there is no beefweb id to address this row by. A row that
			// guessed one would take a 404, which is the one refusal `Artwork`
			// remembers, and the cover would stay blank for the rest of the session
			// however well the join went afterwards.
			let release = () => {};
			const joined = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route("**/api/playlists", async (route) => {
				if (route.request().url().startsWith(String(baseURL)))
					return route.continue();
				await joined;
				await route.continue();
			});

			rowQueuedAtThePlayer(player, "p2", 0);
			await openLibrary(page);
			await openQueue(page);
			await expect(queueRows(page)).toHaveCount(1);

			await expectSettlesAt(player, () => coversAtNoPlaylist(player).length, 0);
			expect(beefwebCovers(player)).not.toContain("/api/artwork/p2/0");

			release();

			await expect(coverOfRow(page, 0)).toHaveAttribute("data-artwork", "ok", {
				timeout: 15_000,
			});
			expect(beefwebCovers(player)).toContain("/api/artwork/p2/0");
			expect(coversAtNoPlaylist(player)).toEqual([]);
		});
	});
});

test.describe("queueing several tracks that share one file", () => {
	test.use({ libraryShape: { tracks: 12, subsongsPerFile: 3 } });

	test("each subsong is queued once, in the order asked for", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"selecting a range is mouse-only; touch queues one row",
		);

		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();

		await trackRow(page, 0).click();
		await trackRow(page, 2).click({ modifiers: ["Shift"] });
		await queueTracks(page, isMobile, 1);

		await expect
			.poll(() => queuedAtThePlayer(player).length, { timeout: 10_000 })
			.toBe(3);

		expect(queuedAtThePlayer(player).map((entry) => entry.title)).toEqual([
			"Track 1",
			"Track 2",
			"Track 3",
		]);
	});
});
