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

// The component owns this playlist and answers to the `queue` role, so its title
// is all a test outside has to find it by.
const holdingOf = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title === "#Jean Queue");

const beefwebWritesNaming = (player: FakePlayer, playlistId: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			entry.path.startsWith("/api/playlists/") &&
			entry.path.split("/").includes(playlistId),
	);

const componentEmptiedTheQueueRole = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "DELETE" &&
			entry.path === "/api/playlists/own/queue/items",
	);

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

	test("queueing sends one request per track, and never a bulk one", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);

		if (isMobile) {
			await queueTracks(page, isMobile, 0);
			await queueTracks(page, isMobile, 1);
			await queueTracks(page, isMobile, 2);
		} else {
			await trackRow(page, 0).click();
			await trackRow(page, 2).click({ modifiers: ["Shift"] });
			await queueTracks(page, isMobile, 1);
		}

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(3);

		const adds = requestsTo(player, "/playqueue/add");
		expect(adds).toHaveLength(3);
		for (const add of adds) expect(typeof add.body?.itemIndex).toBe("number");
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

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);
		expect(requestsTo(player, "/playqueue/add")).toHaveLength(1);
		await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
		await expect(queueRows(page)).toHaveCount(1);
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
		const before = queuedTitles(player);

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

		// `queueIndex` on add is accepted and ignored, so an insert is the tail coming off and going back on with the new track ahead of it -- which is exactly what the two it was dropped above surviving in order proves.
		await expect
			.poll(() => queuedTitles(player).slice(1), { timeout: 10_000 })
			.toEqual(before);
		await expect(queueRows(page)).toHaveCount(3);
	});

	test("a drop below the last row appends without rebuilding", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "drag is mouse-only; touch has the menu");
		await openLibrary(page);
		await queueTracks(page, isMobile, 1);
		await expect(queueRows(page)).toHaveCount(1);

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

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(2);
		expect(requestsTo(player, "/playqueue/remove")).toHaveLength(0);
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

		const before = queuedTitles(player);
		await queueRows(page)
			.nth(1)
			.getByRole("button", { name: /^Remove/ })
			.click();

		await expect(queueRows(page)).toHaveCount(2);
		await expect
			.poll(() => queuedTitles(player), { timeout: 5000 })
			.toEqual([before[0], before[2]]);

		// By queueIndex, which foobar2000 honours here -- unlike on add.
		const removes = requestsTo(player, "/playqueue/remove");
		expect(removes).toHaveLength(1);
		expect(removes[0].body?.queueIndex).toBe(1);
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
		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(0);
		expect(requestsTo(player, "/playqueue/clear")).toHaveLength(1);
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
		// foobar2000 with it, so the order of these two is the assertion.
		const order = player.requests
			.map((entry, at) => ({ ...entry, at }))
			.filter(
				(entry) =>
					entry.path.includes("/playqueue/remove") ||
					entry.path.includes("/playlists/remove/p2"),
			);

		expect(order).toHaveLength(2);
		expect(order[0].path).toContain("/playqueue/remove");
		expect(order[1].path).toContain("/playlists/remove/p2");
		expect(player.playQueue).toHaveLength(0);
	});
});

const drainThePlayQueue = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
	row: number,
) => {
	await openAllMusic(page);
	await queueTracks(page, isMobile, row);
	await expect(queueRows(page)).toHaveCount(1);
	expect(holdingOf(player)?.items).toHaveLength(1);

	await queuePanel(page).getByRole("button", { name: "Clear" }).click();
	await expect(queueRows(page)).toHaveCount(0);
	await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(0);
	expect(holdingOf(player)?.items).toHaveLength(1);
};

test.describe("queueing a row that is in no playlist", () => {
	test.use({ mediaLibrarySize: 400 });

	test("puts it in a holding playlist and queues the real position", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();

		await queueTracks(page, isMobile, 2);
		await expect
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(1);

		const holding = player.playlists.find(
			(entry) => entry.title === "#Jean Queue",
		);
		expect(holding).toBeDefined();

		const entry = player.playQueue[0];
		expect(entry.playlistId).toBe(holding?.id);
		expect(entry.itemIndex).toBeGreaterThanOrEqual(0);

		const held = player.playlists.find((list) => list.id === entry.playlistId);
		const queuedTitle = held?.items[entry.itemIndex]?.["%title%"] as string;
		expect(queuedTitle).toBeTruthy();
		await expect(trackRow(page, 2)).toContainText(queuedTitle);
	});

	test("appends rather than rebuilding, so an earlier entry is undisturbed", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();

		await queueTracks(page, isMobile, 1);
		await expect
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(1);
		const first = { ...player.playQueue[0] };

		await queueTracks(page, isMobile, 4);
		await expect
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(2);

		expect(player.playQueue[0]).toEqual(first);
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/playlists/remove/").length,
			0,
		);
	});

	test("queues again once the play queue has drained, from a holding playlist emptied first", async ({
		page,
		player,
		isMobile,
	}) => {
		await drainThePlayQueue(page, player, isMobile, 1);

		await queueTracks(page, isMobile, 4);
		await expect
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(1);

		const [queued] = queuedTitles(player);
		expect(queued).toBeTruthy();
		await expect(trackRow(page, 4)).toContainText(queued);
		expect(holdingOf(player)?.items).toHaveLength(1);
	});
});

const expectQueueTakesALibraryRow = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
) => {
	await openAllMusic(page);
	await queueTracks(page, isMobile, 2);

	await expect.poll(() => player.playQueue.length, { timeout: 10_000 }).toBe(1);
	const [queued] = queuedTitles(player);
	expect(queued).toBeTruthy();
	await expect(trackRow(page, 2)).toContainText(queued);
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
			.poll(() => player.playQueue.length, { timeout: 10_000 })
			.toBe(1);
		const [queued] = queuedTitles(player);
		expect(queued).toBeTruthy();
		await expect(trackRow(page, 2)).toContainText(queued);
		await expect(queueRows(page)).toHaveCount(1);
	});

	test("empties the holding playlist at the component, and asks beefweb for nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await drainThePlayQueue(page, player, isMobile, 1);
		const held = holdingOf(player)?.id as string;

		await queueTracks(page, isMobile, 4);
		await expect
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(1);

		expect(componentEmptiedTheQueueRole(player)).toHaveLength(1);
		expect(holdingOf(player)?.id).toBe(held);

		// The fake honours no beefweb permission, so a queue that filled is not on
		// its own proof that beefweb was never asked to empty or drop the playlist.
		await expectSettlesAt(
			player,
			() => beefwebWritesNaming(player, held).length,
			0,
		);
	});

	test.describe("with the component's own playlist writes turned off too", () => {
		test.use({ fooJean: { canWritePlaylists: false } });

		// The setting protects the user's music, and the holding playlist holds
		// none of it. A fill addressed by playlist id rather than by role would be
		// refused here, which is what makes the exemption structural.
		test("queues a library row all the same", async ({
			page,
			player,
			isMobile,
		}) => {
			await expectQueueTakesALibraryRow(page, player, isMobile);
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
			.poll(() => player.playQueue.length, { timeout: 10000 })
			.toBe(3);

		expect(queuedTitles(player)).toEqual(["Track 1", "Track 2", "Track 3"]);
		expect(new Set(player.playQueue.map((entry) => entry.itemIndex)).size).toBe(
			3,
		);
	});
});
