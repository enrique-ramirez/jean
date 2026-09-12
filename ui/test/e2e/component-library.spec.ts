import {
	expect,
	expectSettlesAt,
	type FakePlayer,
	FOO_JEAN_TOKEN,
	openSidebar,
	type Page,
	playedFrom,
	requestsTo,
	scratchFills,
	scratchOf,
	sidebar,
	test,
	trackPlayed,
	trackRow,
} from "./fixtures.ts";

// `foo_jean` answers the whole library as one binary snapshot, on its own port and so across a real
// origin boundary, preflight and all. It is the only source there is: beefweb's own library API must
// go unread whatever the component says.

const exportsAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/export").filter(
		(entry) => entry.method === "GET",
	);

const pagesAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/items");

const deltasAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/changes");

const playsOf = (page: Page, row: number) =>
	trackRow(page, row).locator("[data-zero]");

// Every index the player was told to start at, oldest first.
const playsAsked = (player: FakePlayer) =>
	requestsTo(player, "/player/play/").map((entry) =>
		Number(entry.path.split("/").pop()),
	);

const playlistsMade = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" && entry.path.startsWith("/api/playlists/add"),
	);

// beefweb renames by posting a title to the playlist itself, so the body is what
// tells a rename apart from every other post under `/api/playlists/`.
const playlistsRenamed = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/?]+$/.test(entry.path) &&
			entry.body?.title !== undefined,
	);

test.use({ library: { supported: true, enabled: true } });

const openAllMusic = async (page: Page) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

test.describe("the library as one snapshot", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("every track arrives in one export and beefweb is never paged", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expectSettlesAt(player, () => exportsAsked(player).length, 1);
		expect(pagesAsked(player)).toHaveLength(0);
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
		fooJeanToken: FOO_JEAN_TOKEN,
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
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("nothing stands in for it and beefweb is not asked", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(page.getByText("Nothing in your library yet.")).toBeVisible();
		expect(exportsAsked(player)).toHaveLength(0);
		await expectSettlesAt(player, () => pagesAsked(player), []);
	});
});

test.describe("a library that moved while Jean was open", () => {
	test.use({
		fooJean: {},
		fooJeanToken: FOO_JEAN_TOKEN,
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
		fooJeanToken: FOO_JEAN_TOKEN,
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
		expect(deltasAsked(player)).toHaveLength(0);
	});
});

test.describe("playing a set out of the library", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("asks the component for its scratch playlist by role, titled, and makes none through beefweb", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await trackRow(page, 3).dblclick();

		await expectSettlesAt(player, () => scratchFills(player).length, 1);
		// The title rides the call that makes the playlist. Jean's four `#Jean…`
		// readers key on it, and beefweb's playlist list is polled, so a playlist
		// that exists under another name for one poll is a playlist that surfaced.
		expect(scratchFills(player)[0].body?.title).toBe("#Jean [all music]");
		expect(playlistsMade(player)).toHaveLength(0);
		expect(playlistsRenamed(player)).toHaveLength(0);

		expect(scratchOf(player)?.items).toHaveLength(54);
		await openSidebar(page);
		await expect(sidebar(page).getByText(/#Jean/)).toHaveCount(0);
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
	// tag than by path, so the player's own add order is not the library's and a
	// set that arrived through beefweb would land scrambled.
	test.use({
		fooJean: {},
		fooJeanToken: FOO_JEAN_TOKEN,
		mediaLibrarySize: 4000,
	});

	test("plays the row that was clicked, with nothing sent to re-order what the component filled", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await trackRow(page, 12).dblclick();

		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);

		// One component decides the order and does the filling. Jean re-deriving it
		// is what plays a different track on a library with more than one root.
		expect(requestsTo(player, "add-from-library")).toHaveLength(0);
		expect(requestsTo(player, "items/sort")).toHaveLength(0);
	});
});

test.describe("a second view played before the first one has landed", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

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

		// Dropped once both are in flight, so the assertions below wait on the app
		// rather than on the delay.
		await page.request.post("/__control/latency", { data: { ms: 0 } });

		// Row 0 of the search would be index 0. One index, and it is the later one.
		await expectSettlesAt(player, () => playsAsked(player), [3]);
		expect(scratchOf(player)?.title).toBe("#Jean [all music]");
		expect(scratchOf(player)?.items).toHaveLength(54);
	});
});
