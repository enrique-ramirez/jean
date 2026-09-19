import { compareText } from "../fake-api/state.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	openSidebar,
	playedFrom,
	requestsTo,
	scratchFills,
	scratchOf,
	searchFor,
	sidebar,
	test,
	trackPlayed,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

test.describe("playing from all music", () => {
	// Big enough that the set cannot be named track by track: as explicit
	// {path, subsong} it outgrows the 1 MiB body beefweb hangs up over, and as
	// ordinals it outgrows the component's own 256 KiB. The synthesised tracks
	// also sit in a different order by tag than by path -- see `browseOrder` in
	// the fake.
	test.use({ mediaLibrarySize: 30441 });

	test("the whole library is asked for, not named track by track", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"30441",
		);

		await trackRow(page, 0).dblclick();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			30441,
		);

		expect(scratchFills(player)).toHaveLength(1);
		expect(requestsTo(player, "add-from-library")).toHaveLength(0);
	});

	test("the row you click is the row that plays", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Not row 0: a set comes back in the player's own browse order, which
		// agrees with the path order often enough that the first row proves
		// nothing.
		await trackRow(page, 12).dblclick();
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);
	});
});

test.describe("the order a set is played in", () => {
	test.use({ mediaLibrarySize: 4000 });

	test("a search result plays the result that was clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "nutshell");
		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(10);

		await trackRow(page, 7).dblclick();
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 7)).toContainText(trackPlayed(player)!);
	});

	test("the playlist is left in the order the view shows, whatever the player did", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();

		// The set arriving whole, and deliberately not the request log coming to
		// rest: one call fills this playlist, so there is no later round trip to
		// wait for, and waiting for one would let a client that fixed the order up
		// afterwards pass.
		await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(4000);

		const held = scratchOf(player)!.items.map((track) =>
			track["%path%"].replace(/\\/g, "/"),
		);
		expect(held).toEqual([...held].sort(compareText));
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

		// Scoped to this row rather than the whole sidebar: a user playlist marks
		// itself from `isCurrent` and the player arrives with one already set.
		await expect(allMusicRow(page).getByLabel("Playing from here")).toHaveCount(
			0,
		);

		await trackRow(page, 3).dblclick();

		// Before the drawer: on a phone the sidebar covers the status bar, and the
		// way into the now-playing screen is in it.
		await expectPlayingFrom(page, "All music");

		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(1);
	});

	test("browsing away leaves the mark where the sound is", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();
		await openSidebar(page);
		await expect(
			allMusicRow(page).getByLabel("Playing from here"),
		).toBeVisible();

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
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
		// The search row draws itself whenever a query is typed, so it exists here
		// alongside the set that is actually playing.
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 3).dblclick();

		await page.goto("/#/search");
		await searchFor(page, "nutshell");
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

test.describe("a player that reports no permissions at all", () => {
	// Absent is not denied: an older beefweb, or the moment before the first
	// snapshot lands, answers with no permissions object and every reader in the
	// app treats that as allowed.
	test("all music keeps its Shuffle button", async ({ page, player }) => {
		delete (player.player as { permissions?: unknown }).permissions;

		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(
			viewHeader(page).getByRole("button", { name: "Shuffle" }),
		).toBeVisible();
	});
});

test.describe("a beefweb install that will not let Jean change playlists", () => {
	test.use({
		playerState: {
			permissions: {
				changePlaylists: false,
				changeOutput: true,
				changeClientConfig: true,
			},
		},
	});

	// The scratch playlist these two fill is the component's own, made and
	// filled over its own port, so beefweb's permission has nothing to say about
	// playing a library set.
	test("all music keeps Play and Shuffle", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		const header = viewHeader(page);
		await expect(
			header.getByRole("button", { name: "Play", exact: true }),
		).toBeEnabled();
		await expect(
			header.getByRole("button", { name: "Shuffle", exact: true }),
		).toBeEnabled();
	});
});

test.describe("a player with no foo_jean on it at all", () => {
	test.use({ fooJean: null });

	// The other half of the same question. Play and Shuffle wait on the
	// component being reachable rather than on beefweb, so with no component
	// there is nothing to fill a playlist from and no set to play. A build that
	// dropped the gate instead of moving it draws both here.
	test("all music offers neither Play nor Shuffle", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(
			viewHeader(page).getByRole("button", { name: /^(Play|Shuffle)$/ }),
		).toHaveCount(0);
	});
});
