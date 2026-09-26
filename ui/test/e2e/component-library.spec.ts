import type { RecordedRequest } from "../fake-api/state.ts";
import {
	dragFrom,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	type FakePlayer,
	openSidebar,
	type Page,
	playedFrom,
	playRequests,
	pressAndHold,
	requestsTo,
	rowByTitle,
	scratchFills,
	scratchOf,
	scrollUntilMounted,
	sidebar,
	test,
	trackPlayed,
	trackRow,
} from "./fixtures.ts";

// `foo_jean` answers the whole library as one binary snapshot, and it is the only source there is.

const exportsAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/export").filter(
		(entry) => entry.method === "GET",
	);

const deltasAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/changes");

// Ordered against the export that answered a structure move, because a delta asked before it names
// a revision from the structure `foo_jean` has thrown away, which it answers with a 409. The deltas
// after it are ordinary movement in the library Jean now holds.
const deltasAskedBefore = (player: FakePlayer, request: RecordedRequest) => {
	const at = player.requests.indexOf(request);
	return deltasAsked(player).filter(
		(entry) => player.requests.indexOf(entry) < at,
	);
};

const playsOf = (page: Page, row: number) =>
	trackRow(page, row).locator("[data-zero]");

const playsAsked = (player: FakePlayer) =>
	playRequests(player).map((entry) =>
		Number(/\/items\/(\d+)\/play$/.exec(entry.path)?.[1]),
	);

const playlistsMade = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path === "/api/playlists",
	);

const playlistsRenamed = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/?]+$/.test(entry.path) &&
			entry.body?.title !== undefined,
	);

const addsSent = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/]+\/items$/.test(entry.path),
	).length;

const titlesIn = (player: FakePlayer, title: string) =>
	player.playlists
		.find((entry) => entry.title === title)!
		.items.map((track) => track["%title%"]);

const openAllMusic = async (page: Page) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

const FAVORITES = "Favorites";

const menuItem = (page: Page, name: string) =>
	page.getByRole("menuitem", { name, exact: true });

const addToPlaylist = (page: Page) =>
	page.getByRole("menuitem", { name: /Add to playlist/ });

const sidebarRow = (page: Page, title: string) =>
	sidebar(page).locator("> div").filter({ hasText: title });

// Waits on the queue item rather than on Add to playlist, which an install with
// playlist writes off does not draw at all: a helper that waited on it could open
// no menu on the one install this file has a describe about.
const openTrackMenu = async (page: Page, isMobile: boolean, index: number) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(menuItem(page, "Add to queue")).toBeVisible();
};

const fileInto = async (
	page: Page,
	isMobile: boolean,
	index: number,
	title: string,
) => {
	await openTrackMenu(page, isMobile, index);
	await addToPlaylist(page).click();
	await menuItem(page, title).click();
};

test.describe("the library as one snapshot", () => {
	test.use({ fooJean: {} });

	test("every track arrives in one export", async ({ page, player }) => {
		await openAllMusic(page);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expectSettlesAt(player, () => exportsAsked(player).length, 1);
	});

	test("the export declares the columns the app reads", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		expect(player.libraryFeed.columns).toContain("%title%");
		expect(player.libraryFeed.columns).toContain("%album artist%");
		expect(player.libraryFeed.columns).toContain("%play_count%");
	});

	test("rows carry what the player tagged, in path order", async ({ page }) => {
		await openAllMusic(page);

		await expect(trackRow(page, 0)).toContainText("Rotten Apple");
		await expect(trackRow(page, 0)).toContainText("Alice in Chains");
	});

	test("an accented artist is still found by a folded search", async ({
		page,
	}) => {
		await openAllMusic(page);
		await page.goto("/#/search/babasonicos");

		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(0);
		await expect(trackRow(page, 0)).toContainText("Babasónicos");
	});
});

test.describe("a snapshot that has to be built first", () => {
	test.use({
		fooJean: { libraryBuilds: 2 },
	});

	test("the 202 is waited out rather than reported as a failure", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		// One 202, the polls that watched the build, then the export that answered.
		expect(exportsAsked(player)).toHaveLength(2);
		expect(player.libraryFeed.columns.length).toBeGreaterThan(0);
	});
});

test.describe("a component that does not serve the library", () => {
	test.use({
		fooJean: { canReadLibrary: false },
	});

	test("nothing stands in for it", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(page.getByText("Nothing in your library yet.")).toBeVisible();
		await expectSettlesAt(player, () => exportsAsked(player).length, 0);
	});
});

test.describe("a library that moved while Jean was open", () => {
	test.use({
		fooJean: {},
		countsPlays: true,
	});

	test("a play count that advanced arrives as a patch, not a second export", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		const plays = playsOf(page, 0);
		const before = Number(await plays.innerText());

		// Playing the second row is what makes the first stop being the active track, which is when a
		// player with a playback-statistics component records the play.
		await trackRow(page, 0).dblclick();
		await trackRow(page, 1).dblclick();

		await expect(plays).toHaveText(String(before + 1), { timeout: 20_000 });
		expect(deltasAsked(player).length).toBeGreaterThan(0);
		expect(exportsAsked(player)).toHaveLength(1);
	});
});

test.describe("a library rebuilt under Jean", () => {
	test.use({
		fooJean: { libraryRebuilds: 1 },
		countsPlays: true,
	});

	test("the structure moving is another export rather than an error", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await trackRow(page, 0).dblclick();
		await trackRow(page, 1).dblclick();

		await expect
			.poll(() => exportsAsked(player).length, { timeout: 20_000 })
			.toBe(2);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expect(trackRow(page, 0)).toContainText("Rotten Apple");
		expect(deltasAskedBefore(player, exportsAsked(player)[1])).toHaveLength(0);
	});
});

test.describe("a library rebuilt while Jean was reading the one before it", () => {
	test.use({ fooJean: {} });

	const ADDED = "Late Arrival";

	// A rescan that found one more file, in a folder the fixture already has: the
	// library root stays where it was, so every other track keeps its ordinal and
	// the added one is the whole difference between the two generations.
	const rebuildWithOneMoreTrack = (player: FakePlayer) => {
		const template = player.libraryTracks[0];
		player.libraryTracks.push({
			...template,
			"%title%": ADDED,
			"%tracknumber%": "99",
			"%path%": template["%path%"].replace(/[^\\]+$/, `99 ${ADDED}.mp3`),
		});
		player.libraryFeed.building = [...player.libraryFeed.columns];
		player.finishLibraryBuild();
	};

	// The component reads the snapshot off the library it holds at that moment, so a
	// rescan that starts afterwards leaves what is on the wire a generation old.
	// Fetched as soon as it is asked for and handed to the page only once the test
	// says so, which is what puts the rebuild inside the read rather than before it.
	const holdTheExport = async (page: Page) => {
		let answered = () => {};
		let release = () => {};
		const onTheWire = new Promise<void>((resolve) => {
			answered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});

		await page.route(
			"**/api/library/export**",
			async (route) => {
				const response = await route.fetch();
				const body = await response.body();
				answered();
				await held;
				await route.fulfill({ response, body });
			},
			{ times: 1 },
		);

		return { onTheWire, release: () => release() };
	};

	// `GET /api/state`'s ETag covers the structure and the revision, so this is the
	// last 200 there will be until something else moves the player: every poll from
	// here answers 304, and a notice dropped now is a notice gone for good.
	const noticeOfTheRebuild = (page: Page, before: number) =>
		page.waitForResponse(
			async (response) =>
				response.url().endsWith("/api/state") &&
				response.status() === 200 &&
				((await response.json()) as { library: { structure: number } }).library
					.structure > before,
		);

	test("the track the rebuild added is on screen, and playing it is not refused", async ({
		page,
		player,
	}) => {
		const { onTheWire, release } = await holdTheExport(page);

		await page.goto("/#/all");
		await onTheWire;

		const noticed = noticeOfTheRebuild(page, player.libraryFeed.structure);
		rebuildWithOneMoreTrack(player);
		await noticed;
		release();

		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"55",
			{ timeout: 20_000 },
		);

		const row = rowByTitle(page, ADDED);
		await scrollUntilMounted(page, row);
		await row.dblclick();

		await expect.poll(() => trackPlayed(player)).toBe(ADDED);
	});
});

test.describe("playing a set out of the library", () => {
	test.use({ fooJean: {} });

	test("asks the component for its scratch playlist by role, titled, and makes or renames none", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await trackRow(page, 3).dblclick();

		await expectSettlesAt(player, () => scratchFills(player).length, 1);
		// The title rides the call that makes the playlist. Jean's four `#Jean…`
		// readers key on it, and the playlist list is read on a poll, so a playlist
		// that exists under another name for one poll is a playlist that surfaced.
		expect(scratchFills(player)[0].body?.title).toBe("#Jean [all music]");
		expect(playlistsMade(player)).toHaveLength(0);
		expect(playlistsRenamed(player)).toHaveLength(0);

		expect(scratchOf(player)?.items).toHaveLength(54);
		await openSidebar(page);
		// The pair, because either half alone passes against a filter that is
		// wrong in one direction: the playlist the component made for this fill is
		// out, and the user's own, which only shares its title's prefix, is in.
		await expect(sidebar(page).getByText("#Jean [all music]")).toHaveCount(0);
		await expect(sidebar(page).getByText("#Jean Library")).toHaveCount(1);
	});

	test("a second row from the same view plays without filling the playlist again", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await trackRow(page, 3).dblclick();
		await expectSettlesAt(player, () => scratchFills(player).length, 1);

		await trackRow(page, 8).dblclick();

		await expect.poll(() => playedFrom(player)?.index).toBe(8);
		await expectSettlesAt(player, () => scratchFills(player).length, 1);
	});
});

test.describe("the order a library set plays in", () => {
	// Synthesised rather than captured: these tracks sit in a different order by
	// tag than by path, so a set filled in path order rather than in the
	// component's library order would land scrambled.
	test.use({
		fooJean: {},
		mediaLibrarySize: 4000,
	});

	test("plays the row that was clicked", async ({ page, player }) => {
		await openAllMusic(page);

		await trackRow(page, 12).dblclick();

		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);
	});
});

test.describe("a second view played before the first one has landed", () => {
	test.use({ fooJean: {} });

	// The component applies fills in the order they arrived, so the later click
	// wins the playlist whichever response Jean waited for. What is left to get
	// wrong is the response: acting on the abandoned one starts the wrong track.
	test("plays only the view that was clicked last, never the one it gave up on", async ({
		page,
		player,
	}) => {
		await page.request.post("/__control/latency", { data: { ms: 1200 } });

		await page.goto("/#/search/babasonicos");
		await expect(trackRow(page, 0)).toBeAttached();
		await trackRow(page, 0).dblclick();

		await openAllMusic(page);
		await trackRow(page, 3).dblclick();

		await page.request.post("/__control/latency", { data: { ms: 0 } });

		await expectSettlesAt(player, () => playsAsked(player), [3]);
		expect(scratchOf(player)?.title).toBe("#Jean [all music]");
		expect(scratchOf(player)?.items).toHaveLength(54);
	});
});

test.describe("a view whose fill was refused because the library moved", () => {
	test.use({ fooJean: {} });

	// Two genres the captured library holds the same number of tracks in, so the
	// row counts agree after a refused fill and the playlist's title is the only
	// thing left saying which of them is in there.
	const HELD = "Alternative Rock";
	const ASKED = "Indie Rock";

	// Different rows in each view, so a track played from the wrong one is never the
	// track that was already playing.
	const HELD_ROW = 0;
	const ASKED_ROW = 3;

	const openGenre = async (page: Page, genre: string) => {
		await page.goto(`/#/genre/${encodeURIComponent(genre)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: genre }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
	};

	const rebuildLibrary = (player: FakePlayer) => {
		player.libraryFeed.building = [...player.libraryFeed.columns];
		player.finishLibraryBuild();
	};

	// Jean re-reads the library when the tab comes back, which is what a 409 asks of
	// a client: export again, then ask again. Given here so the click that follows has
	// a current snapshot to fill from.
	const comeBackToTheTab = (page: Page) =>
		page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

	// The rebuild lands while the fill is held: 409, nothing inserted, and the
	// playlist still holding and naming the first view.
	const refuseAFill = async (page: Page, player: FakePlayer) => {
		await openGenre(page, HELD);
		await trackRow(page, HELD_ROW).dblclick();
		await expectSettlesAt(player, () => scratchFills(player).length, 1);

		await openGenre(page, ASKED);
		await page.request.post("/__control/latency", { data: { ms: 1200 } });

		const refused = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/playlists/own/scratch/items") &&
				response.status() === 409,
		);
		await trackRow(page, ASKED_ROW).dblclick();
		await expect.poll(() => scratchFills(player).length).toBe(2);

		rebuildLibrary(player);
		await page.request.post("/__control/latency", { data: { ms: 0 } });
		await refused;
	};

	test("asking for it again plays its own rows, not the ones the playlist kept", async ({
		page,
		player,
	}) => {
		await refuseAFill(page, player);
		await comeBackToTheTab(page);
		await expect.poll(() => exportsAsked(player).length).toBe(2);

		await trackRow(page, ASKED_ROW).dblclick();

		await expect.poll(() => playRequests(player)).toHaveLength(2);
		await expect(trackRow(page, ASKED_ROW)).toContainText(
			trackPlayed(player) as string,
		);
	});

	test("the refusal is caught rather than reaching the page as an uncaught error", async ({
		page,
		player,
	}) => {
		const uncaught: string[] = [];
		page.on("pageerror", (error) => uncaught.push(error.message));

		await refuseAFill(page, player);

		await expectSettlesAt(player, () => uncaught, []);
	});
});

test.describe("a view another device played over this one's", () => {
	test.use({ fooJean: {} });

	// Another device fills the one scratch playlist every client shares, straight
	// through the component, and leaves nothing behind in this page's storage.
	const playFromAnotherDevice = async (page: Page, title: string) => {
		const state = await (await page.request.get("/api/state")).json();
		const filled = await page.request.post("/api/playlists/own/scratch/items", {
			data: { title, structure: state.library.structure, ordinals: [0] },
		});
		expect(filled.ok()).toBe(true);
		const { playlistId } = await filled.json();
		const played = await page.request.post(
			`/api/playlists/${playlistId}/items/0/play`,
			{ data: {} },
		);
		expect(played.ok()).toBe(true);
	};

	test("is what this device says it is playing from", async ({ page }) => {
		await page.goto(`/#/genre/${encodeURIComponent("Alternative Rock")}`);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, "Alternative Rock");

		await playFromAnotherDevice(page, "#Jean [genre: Indie Rock]");

		await expectPlayingFrom(page, "Indie Rock");
	});
});

test.describe("filing a library row into a playlist of your own", () => {
	test.use({ fooJean: {} });

	test("goes to the component by playlist id", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		const before = titlesIn(player, FAVORITES);

		await fileInto(page, isMobile, 2, FAVORITES);

		await expect(page.getByRole("status")).toContainText(
			`Added 1 track to ${FAVORITES}`,
		);

		// The row that was clicked rather than merely a row: a ref is an ordinal in
		// the component's library order, which is not the order of the paths.
		const after = titlesIn(player, FAVORITES);
		expect(after).toHaveLength(before.length + 1);
		await expect(trackRow(page, 2)).toContainText(after.at(-1) as string);

		await expectSettlesAt(player, () => addsSent(player), 1);
	});

	test("the sidebar row lights up as a drop target, and the dropped row is filed there", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a row onto a playlist is mouse-only");

		await openAllMusic(page);
		await openSidebar(page);
		const before = titlesIn(player, FAVORITES);

		const target = sidebarRow(page, FAVORITES);
		await dragFrom(page, trackRow(page, 2), target);
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect(page.getByRole("status")).toContainText(
			`Added 1 track to ${FAVORITES}`,
		);

		await expect
			.poll(() => titlesIn(player, FAVORITES).length)
			.toBe(before.length + 1);
		const after = titlesIn(player, FAVORITES);
		await expect(trackRow(page, 2)).toContainText(after.at(-1) as string);

		await expectSettlesAt(player, () => addsSent(player), 1);
	});

	test.describe("where the player owner has turned playlist writes off", () => {
		test.use({ fooJean: { canWritePlaylists: false } });

		test("the sidebar row never offers itself as a drop target, and no fill is sent", async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(isMobile, "dragging a row onto a playlist is mouse-only");

			await openAllMusic(page);
			await openSidebar(page);
			const before = titlesIn(player, FAVORITES);

			const target = sidebarRow(page, FAVORITES);
			await dragFrom(page, trackRow(page, 2), target);

			// Read while a row is still held over the sidebar: `data-receiving` is what
			// says the drag reached it at all, so the missing target is a refusal rather
			// than a gesture that never started.
			await expect(sidebar(page)).toHaveAttribute("data-receiving", "true");
			await expect(target).not.toHaveAttribute("data-drop-target");
			await expect(target).not.toHaveAttribute("data-drop-over");
			await page.mouse.up();

			await expectSettlesAt(player, () => addsSent(player), 0);
			expect(titlesIn(player, FAVORITES)).toEqual(before);
		});

		test("the same row still queues", async ({ page, player, isMobile }) => {
			await openAllMusic(page);
			await openTrackMenu(page, isMobile, 2);

			const queue = menuItem(page, "Add to queue");
			// Named rather than left to the click's own actionability wait, which
			// reports a timeout where the real answer is that the item was refused.
			await expect(queue).toBeEnabled();
			await queue.click();

			await expect
				.poll(() => player.playQueue.length, { timeout: 10_000 })
				.toBe(1);
		});

		// Nothing about this install can make the item work, so the menu is one row
		// shorter rather than carrying one that explains itself.
		test("Add to playlist is not in the row menu at all", async ({
			page,
			isMobile,
		}) => {
			await openAllMusic(page);
			await openTrackMenu(page, isMobile, 2);

			await expect(addToPlaylist(page)).toHaveCount(0);
		});
	});

	test.describe("on a component too old to report the setting at all", () => {
		test.use({ fooJean: { canWritePlaylists: "absent" } });

		test("Add to playlist still offers the playlists a row can go to", async ({
			page,
			isMobile,
		}) => {
			await openAllMusic(page);
			await openTrackMenu(page, isMobile, 2);

			await expect(addToPlaylist(page)).toBeEnabled();
			await addToPlaylist(page).click();
			await expect(menuItem(page, FAVORITES)).toBeVisible();
		});
	});
});
