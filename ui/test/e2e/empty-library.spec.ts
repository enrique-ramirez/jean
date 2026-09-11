import {
	expect,
	expectSettlesAt,
	openSidebar,
	requestsTo,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";

// Three states nothing else in the suite loads: a library with no tracks in it,
// a library carrying no genre tags at all, and a library read that fails. All
// three are ordinary -- a fresh foobar2000 whose media library is still
// scanning, a collection ripped from CDs, and a player that went away mid-load.

test.describe("a library with nothing in it", () => {
	test.use({ libraryShape: { tracks: 0 } });

	test("home says so rather than drawing an empty shelf", async ({ page }) => {
		await page.goto("/");
		await expect(
			viewHeader(page).getByRole("heading", { level: 1 }),
		).toBeVisible();

		await expect(
			page.getByText("Nothing to show from your library yet."),
		).toBeVisible();
		// Not the fallback shelf either: "Start somewhere" over no records is an
		// empty row with a title on it.
		await expect(page.getByText("Start somewhere")).toHaveCount(0);
	});

	test("nothing offers to play it, and nothing is written to the player", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(
			viewHeader(page).getByRole("heading", { level: 1 }),
		).toBeVisible();

		// Filling the scratch with nothing and playing position 0 of it is a
		// request the player answers with an error nobody asked for.
		await expect(
			viewHeader(page).getByRole("button", { name: /^(Play|Shuffle)$/ }),
		).toHaveCount(0);
		await expectSettlesAt(
			player,
			() => requestsTo(player, "/player/play/"),
			[],
		);
		expect(
			player.playlists.some((entry) => entry.title.startsWith("#Jean [")),
		).toBe(false);
	});

	test("All music is a view of nothing rather than a broken grid", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.locator('[role="row"]')).toHaveCount(0);
	});

	test("the genres index says nothing is tagged", async ({ page }) => {
		await page.goto("/#/genres");
		await expect(
			page.getByText("Nothing in your library carries a genre tag."),
		).toBeVisible();
	});
});

// An ordinary state for a collection ripped from CDs, and the one the genres
// index has never been loaded against: `withoutFields: ['%genre%']` was only
// ever pointed at the home screen.
test.describe("a library with no genre tags", () => {
	test.use({ withoutFields: ["%genre%"] });

	test("the genres index is an explanation, not an empty grid", async ({
		page,
	}) => {
		await page.goto("/#/genres");

		await expect(
			page.getByText("Nothing in your library carries a genre tag."),
		).toBeVisible();
		await expect(page.getByRole("link", { name: /tracks?$/ })).toHaveCount(0);
	});

	test("its finder is not offered, because there is nothing to find", async ({
		page,
	}) => {
		await page.goto("/#/genres");
		await expect(
			page.getByText("Nothing in your library carries a genre tag."),
		).toBeVisible();

		await expect(
			page.getByRole("textbox", { name: /Find a genre/ }),
		).toHaveCount(0);
	});

	test("the sidebar still offers the row, and it leads somewhere honest", async ({
		page,
	}) => {
		// The row is a fixture of the sidebar rather than a function of the tags,
		// so it must not lead to a screen that looks broken.
		await page.goto("/");
		await openSidebar(page);
		const genres = sidebar(page).getByRole("button", { name: "Genres" });
		if ((await genres.count()) === 0)
			test.skip(true, "no genres row on this build");

		await genres.click();
		await expect(
			page.getByText("Nothing in your library carries a genre tag."),
		).toBeVisible();
	});
});

test.describe("a library read that fails", () => {
	test("home says what went wrong instead of showing an empty collection", async ({
		page,
	}) => {
		// The player answering an error is not the same as the player having
		// nothing: "Nothing to show" over a failed read is Jean telling the user
		// their library is empty when it is not.
		await page.route("**/api/library/export**", (route) =>
			route.fulfill({ status: 500, body: '{"error":"no"}' }),
		);

		await page.goto("/");

		await expect(page.getByText(/Could not read your library/)).toBeVisible();
	});
});
