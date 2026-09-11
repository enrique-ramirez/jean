import {
	expect,
	expectSettlesAt,
	type FakePlayer,
	FOO_JEAN_TOKEN,
	type Page,
	requestsTo,
	test,
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
