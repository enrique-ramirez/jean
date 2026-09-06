import {
	expect,
	expectSettlesAt,
	playedFrom,
	requestsTo,
	scratchOf,
	searchFor,
	test,
	trackPlayed,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

// The DeaDBeeF steady state, pinned so it runs on a default gate. Every other
// spec that sets `library: { supported: false }` also drops the autoplaylist and
// lands on the first-run setup screen, so the path a real DeaDBeeF install takes
// -- no media library API, `#Jean Library` present, everything working off it --
// was only ever exercised by the separate `JEAN_NO_LIBRARY_API=1` run.
test.describe("a player with no media library API", () => {
	test.use({ library: { supported: false } });

	test("home fills from the autoplaylist rather than asking for setup", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(
			viewHeader(page).getByRole("heading", { level: 1 }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /Point Jean at your library/ }),
		).toHaveCount(0);
		await expect(
			page.getByText("Nothing to show from your library yet."),
		).toHaveCount(0);
	});

	test("All music browses it, and the rows are the real tracks", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expect(trackRow(page, 0)).toContainText("Los Calientes");
	});

	test("nothing is asked of the endpoints this player answers 501 for", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();

		// `/library/info` is how a client discovers it has no library and is the
		// one call that must still happen; a 501 anywhere else is Jean asking a
		// question it has already been answered.
		await expectSettlesAt(
			player,
			() =>
				requestsTo(player, "/api/library/")
					.map((entry) => entry.path)
					.filter((path) => !path.startsWith("/api/library/info")),
			[],
		);
	});

	test("search finds a track and playing it plays that track", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "nutshell");
		await expect(trackRow(page, 0)).toContainText("Nutshell");

		await trackRow(page, 0).dblclick();

		// Through the scratch playlist, as on any player: the set is materialised
		// the same way whichever source found it.
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		expect(trackPlayed(player)).toBe("Nutshell");
	});

	test("the genres index still works, because it reads rows Jean already holds", async ({
		page,
	}) => {
		await page.goto("/#/genres");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(
			page.getByText("Nothing in your library carries a genre tag."),
		).toHaveCount(0);
	});
});
