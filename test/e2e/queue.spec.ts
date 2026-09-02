import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	pressAndHold,
	requestsTo,
	sidebar,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

// The status bar on a desktop; the now-playing screen's header on a phone,
// where the compact strip is down to Play and volume. The drop target is only
// ever the status-bar one -- dragging is mouse-only, so it is desktop-only too.
const queueButton = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^Queue/ });

const anyQueueButton = async (page: Page) => {
	if (await queueButton(page).count()) return queueButton(page);
	await openNowPlaying(page);
	return nowPlayingScreen(page).getByRole("button", { name: /^Queue/ });
};

const openQueue = async (page: Page) => {
	(await anyQueueButton(page)).click();
	await expect(
		queuePanel(page).getByRole("heading", { name: "Queue" }),
	).toBeVisible();
};

const queueRows = (page: Page) => queuePanel(page).getByRole("listitem");

const queueTracks = async (page: Page, isMobile: boolean, index = 0) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	const item = page.getByRole("menuitem", { name: "Add to queue" });
	await item.click();
	// The sheet plays a 220ms exit, and a second hold fired into it is swallowed.
	await expect(item).toHaveCount(0);
};

// Off the playlist, because what the queue promises is a playlist and a
// position -- the control surface resolves no columns.
const queuedTitles = (player: FakePlayer) =>
	player.playQueue.map((entry) => {
		const playlist = player.playlists.find(
			(entry_) => entry_.id === entry.playlistId,
		);
		return playlist?.items[entry.itemIndex]?.["%title%"] ?? "";
	});

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

	// The other half of the drag that already ends on a sidebar playlist. Tested
	// here rather than beside that one because what it asserts is the queue: the
	// gesture is the sidebar's, the destination is this file's.
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

		// Armed on an animation frame rather than on the move event, so this is a
		// poll and not a read.
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect.poll(() => player.playQueue.length, { timeout: 5000 }).toBe(1);
		expect(requestsTo(player, "/playqueue/add")).toHaveLength(1);
		// The drop is the same route the menu takes, undo and all, and the queue
		// panel is shut -- so it has to say something.
		await expect(page.getByRole("status")).toContainText("Queued 1 track");
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
		// Armed is not the same as under the pointer: the button says it takes
		// tracks without claiming this one is landing on it.
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
		// Left of the button is the Next-track button, so a point there arms only
		// if the grown hit area really is what the document hit test lands on.
		const beside = { x: drop!.x - 6, y: drop!.y + drop!.height / 2 };

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(beside.x, beside.y, { steps: 16 });
		await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		// And it goes with the drag: at rest that point is not the button's, so
		// nothing beside it has quietly lost a strip of itself for the session.
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

		const labels = await statusBar(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			);

		expect(labels[labels.indexOf("Next track") + 1]).toBe("Queue");
	});

	test("the badge counts what is queued", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);

		// Read wherever the button lives, and come back to the list afterwards --
		// on a phone it is on the now-playing screen, and the tracks being queued
		// are in the list behind it.
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
		await expect(page.locator("aside")).toHaveCSS("position", "absolute");
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

		// An empty queue has no rows, so nothing else on this panel is ticking --
		// which is exactly how the origin label came to be drawn once and left.
		const label = queuePanel(page).getByText(/left of this track/);
		const first = await label.textContent();
		await expect
			.poll(() => label.textContent(), { timeout: 5000 })
			.not.toBe(first);
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

		// Through the player, not the UI: Next is desktop-only now.
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

test.describe("queueing a row that is in no playlist", () => {
	test.use({ mediaLibrarySize: 400 });

	test("puts it in a holding playlist and queues the real position", async ({
		page,
		player,
		isMobile,
		hasLibraryApi,
	}) => {
		test.skip(
			!hasLibraryApi,
			"without the library API every row is already in the autoplaylist, so there is nothing to hold",
		);

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
		hasLibraryApi,
	}) => {
		test.skip(!hasLibraryApi, "no holding playlist without the library API");

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
		expect(requestsTo(player, "/playlists/remove/")).toHaveLength(0);
	});
});
