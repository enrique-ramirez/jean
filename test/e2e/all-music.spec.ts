import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	openSidebar,
	playedFrom,
	requestsTo,
	scratchOf,
	sidebar,
	test,
	trackPlayed,
	trackRow,
} from "./fixtures.ts";

// Two of the tests below are about *how* the library source fills a playlist,
// and the autoplaylist fallback does not fill one that way: `items/copy` hands
// the player indices into a playlist it already has, so there is no body to
// outgrow and no order to put back. The behaviour either source has to get
// right -- the row you click is the row that plays -- is asserted for both.
const libraryApiOnly = (hasLibraryApi: boolean) =>
	test.skip(
		!hasLibraryApi,
		"the autoplaylist fallback copies by index, so neither the size limit nor the sort applies",
	);

test.describe("playing from all music", () => {
	// Big enough that the set cannot be named in one request: as explicit
	// {path, subsong} it outgrows the 1 MiB body beefweb hangs up over, which is
	// exactly why All music could not play anything at all. The synthesised
	// tracks also sit in a different order by tag than by path, which is the
	// second half of it -- see `browseOrder` in the fake.
	test.use({ mediaLibrarySize: 30441 });

	test("the whole library is asked for, not named track by track", async ({
		page,
		player,
		hasLibraryApi,
	}) => {
		libraryApiOnly(hasLibraryApi);
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"30441",
		);

		await trackRow(page, 0).dblclick();
		await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(30441);

		// One request carrying no `items` at all, which is how the API says "the
		// whole library". Naming them is both too big to send and slow enough to
		// resolve per track that a regression here is either a dead button or a
		// wait of tens of seconds, depending on which limit it hits first.
		const adds = requestsTo(player, "add-from-library");
		expect(adds.length).toBe(1);
		expect(adds[0].body?.items).toBeUndefined();
		expect(adds[0].body?.replace).toBe(true);
	});

	test("the row you click is the row that plays", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Not row 0. A set comes back in the player's own browse order, which
		// agrees with the path order Jean shows often enough that the first row
		// proves nothing.
		await trackRow(page, 12).dblclick();
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);
	});
});

test.describe("the order a set is played in", () => {
	test.use({ mediaLibrarySize: 4000 });

	// A named set rather than a wholesale one, so this covers the other half of
	// `fill`: chunked adds followed by the same sort.
	test("a search result plays the result that was clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await page.getByRole("searchbox").fill("nutshell");
		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(10);

		await trackRow(page, 7).dblclick();
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		await expect(trackRow(page, 7)).toContainText(trackPlayed(player)!);
	});

	test("the playlist is left in the order the view shows, whatever the player did", async ({
		page,
		player,
		hasLibraryApi,
	}) => {
		libraryApiOnly(hasLibraryApi);
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();

		// Polled on the sort, not on the item count: the add lands first and the
		// sort a round trip later, so asserting on the contents the moment they
		// arrive reads the playlist half way through being filled.
		await expect.poll(() => requestsTo(player, "items/sort").length).toBe(1);
		expect(scratchOf(player)!.items.length).toBe(4000);

		// Sorted by the same expression the library is read with. Without it the
		// playlist holds the right tracks in the wrong places, and every position
		// Jean computes addresses somebody else's song.
		expect(requestsTo(player, "items/sort")[0].body?.by).toBe("%path%");

		const held = scratchOf(player)!.items.map((track) =>
			track["%path%"].replace(/\\/g, "/"),
		);
		expect(held).toEqual([...held].sort((a, b) => a.localeCompare(b)));
	});
});

test.describe("where the music is coming from", () => {
	test.use({ mediaLibrarySize: 4000 });

	const allMusicRow = (page: Page) =>
		sidebar(page).getByRole("button", { name: /All music/ });

	test("All music is marked as playing, in the row it already has", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Not marked before anything is played. Scoped to this row rather than the
		// whole sidebar, because a user playlist marks itself from `isCurrent` and
		// the player arrives with one already set -- that is the desktop's state
		// showing through, which is deliberate. Checked without opening the drawer:
		// on a phone it would cover the very row the next line clicks.
		await expect(allMusicRow(page).getByLabel("Playing from here")).toHaveCount(
			0,
		);

		await trackRow(page, 3).dblclick();

		// Before the drawer: on a phone the sidebar covers the status bar, and the
		// way into the now-playing screen is in it.
		await expectPlayingFrom(page, "All music");

		// A shelf gets a temporary row because it has none of its own. All music
		// has one, and marking it in place is the whole reason the temporary row is
		// reserved for shelves.
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		// Only one row is ever the one playing: the accent says where the sound is
		// coming from, not which row is open.
		await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(1);
	});

	test("browsing away leaves the mark where the sound is", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();
	});

	test("a live search is not marked by somebody else playing", async ({
		page,
	}) => {
		// The search row draws itself whenever a query is typed, and it used to ask
		// "is any Jean playlist current" rather than "is this set the one playing".
		// A shelf started with a query still in the field lit up both.
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();

		await page.goto("/#/search");
		await page.getByRole("searchbox").fill("nutshell");
		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(10);

		await openSidebar(page);
		const search = sidebar(page).getByRole("button", { name: /nutshell/ });
		await expect(search).toBeVisible();
		await expect(search.getByLabel("Playing from here")).toHaveCount(0);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();
	});
});
