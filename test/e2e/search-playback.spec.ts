import type { Track } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	openSidebar,
	playedFrom,
	requestsTo,
	revealSearch,
	scratchOf,
	searchFor,
	sidebar,
	statusBar,
	test,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

// 'babasonicos' matches the twelve Jessico tracks, library indices 0-11.
const QUERY = {
	text: "babasonicos",
	matches: 12,
	title: "#Jean [search: babasonicos]",
};
const NARROWER = {
	text: "delectrico",
	matches: 1,
	title: "#Jean [search: delectrico]",
};

const search = async (page: Page, text: string) => {
	await page.goto("/#/search");
	await searchFor(page, text);
	await expect(trackRow(page, 0)).toBeAttached();
};

const searchAndPlay = async (
	page: Page,
	player: FakePlayer,
	query = QUERY,
	row = 0,
) => {
	await search(page, query.text);
	await trackRow(page, row).dblclick();
	await expect.poll(() => scratchOf(player)?.items.length).toBe(query.matches);
};

const saveAs = async (page: Page, name: string) => {
	await page.getByRole("button", { name: "Save as playlist" }).click();
	await page.getByRole("textbox", { name: "Playlist name" }).fill(name);
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

// `jeanPlaylists.ts` splits a scratch title on the *first* separator so that a
// query containing a colon round-trips, and nothing anywhere searched for one.
// An album titled `Something: Deluxe Edition` is ordinary, and the failure is
// silent: the header names the tail of the query and the search entry takes you
// back to a narrower search than you ran.
test.describe("a query with a colon in it", () => {
	test.use({
		retagged: { Nutshell: { "%album%": "Jar Of Flies: Deluxe Edition" } },
	});

	const COLON = "flies: deluxe";

	test("comes back whole, in the header and in the sidebar", async ({
		page,
		player,
	}) => {
		await search(page, COLON);
		await trackRow(page, 0).dblclick();
		await expect.poll(() => scratchOf(player)).not.toBeUndefined();

		await expectPlayingFrom(page, COLON);

		await openSidebar(page);
		await expect(sidebar(page).getByText(COLON, { exact: true })).toBeVisible();
	});

	test("a reload takes you back to the whole query", async ({
		page,
		player,
	}) => {
		await search(page, COLON);
		await trackRow(page, 0).dblclick();
		await expect.poll(() => scratchOf(player)).not.toBeUndefined();

		// Reloaded rather than navigated: a hashchange keeps the query in memory,
		// so only a fresh page reads it back out of the playlist's title -- which
		// is the round trip the colon can break.
		await page.goto("/#/p7");
		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		await openSidebar(page);
		await sidebar(page).getByText(COLON, { exact: true }).click();

		await expect(page.getByLabel("Search your library")).toHaveValue(COLON);
		await expect(
			page.getByRole("heading", { level: 1, name: COLON }),
		).toBeVisible();
	});
});

test.describe("playing from search results", () => {
	test("the results become a real playlist and playback happens inside it", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);

		// Typing and refining stay client-side; nothing reaches the player yet.
		await expectSettlesAt(player, () => scratchOf(player), undefined);

		await trackRow(page, 2).dblclick();

		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(QUERY.matches);
		const scratch = scratchOf(player);
		expect(scratch!.title).toBe(QUERY.title);

		await expect.poll(() => playedFrom(player)?.plref).toBe(scratch!.id);
		expect(playedFrom(player)!.index).toBe(2);
	});

	test("it holds exactly the matches, in the order shown", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		const library = player.playlists.find(
			(entry) => entry.title === "Library",
		)!;
		const titleOf = (track: Track) => track["%title%"];

		// The copy is by index, so an off-by-one still produces twelve items.
		expect(scratchOf(player)!.items.map(titleOf)).toEqual(
			library!.items.slice(0, QUERY.matches).map(titleOf),
		);
	});

	test("refining the query rebuilds it rather than making another", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		const firstId = scratchOf(player)!.id;

		await searchFor(page, NARROWER.text);
		await trackRow(page, 0).dblclick();

		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(NARROWER.matches);
		expect(
			player.playlists.filter((entry) => entry.title.startsWith("#Jean [")),
		).toHaveLength(1);
		expect(scratchOf(player)!.id).toBe(firstId);
		expect(scratchOf(player)!.title).toBe(NARROWER.title);
	});

	test("playing a second result from the same search does not rebuild it", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		const copiesBefore = requestsTo(player, "/items/copy").length;
		await trackRow(page, 5).dblclick();

		await expect.poll(() => playedFrom(player)?.index).toBe(5);
		expect(requestsTo(player, "/items/copy")).toHaveLength(copiesBefore);
	});

	test("shuffle shuffles the results and nothing else", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);

		await viewHeader(page).getByRole("button", { name: "Shuffle" }).click();

		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(QUERY.matches);
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)!.id);
		// 4 is the player's shuffle-by-tracks order.
		await expect.poll(() => player.player.playbackMode).toBe(4);
		expect(playedFrom(player)!.index).toBeLessThan(QUERY.matches);
	});

	test("Jean does not show its own scratch playlist anywhere", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();

		await openSidebar(page);
		await expect(sidebar(page).getByText("Rock en Español")).toBeVisible();
		await expect(sidebar(page).getByText(QUERY.title)).toHaveCount(0);
	});

	test("and does not offer it as somewhere to file tracks", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();

		// The next search empties the scratch playlist, so anything filed there goes.
		await trackRow(page, 0).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Add to playlist" }).click();

		await expect(
			page.getByRole("menuitem", { name: "Favorites" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: QUERY.title })).toHaveCount(
			0,
		);
	});

	test("and does not offer it as somewhere to go", async ({ page, player }) => {
		test.skip(
			test.info().project.name === "mobile",
			"the palette is a keyboard shortcut",
		);

		await searchAndPlay(page, player);

		await page.keyboard.press("g");
		// Scoped to the palette: the sidebar names these playlists too.
		const palette = page.getByRole("dialog", { name: "Go to" });
		await expect(
			palette.getByRole("option", { name: "Favorites" }),
		).toBeVisible();
		await expect(
			palette.getByRole("option", { name: QUERY.title }),
		).toHaveCount(0);
	});
});

test.describe("a search outlives the tab it was typed in", () => {
	test("a reload comes back to the same results", async ({ page, player }) => {
		await searchAndPlay(page, player);

		await page.reload();

		// The query is not stored in the browser; the scratch playlist's title is
		// what remembers it.
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY.text }),
		).toBeVisible();
		await expect(page.getByLabel("Search your library")).toHaveValue(
			QUERY.text,
		);
		await expect(page.locator('[role="row"]').first()).toContainText(
			"Los Calientes",
		);
	});

	test("another device finds it, and can see it is what is playing", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		// Stands in for another device: local state cleared, landing off the search
		// route.
		await page.goto("/#/p7");
		await page.evaluate(() => localStorage.clear());
		await page.goto("/#/p7");
		await expect(statusBar(page)).toContainText("Los Calientes");

		await openSidebar(page);
		await expect(sidebar(page).getByText(QUERY.text)).toBeVisible();
		await expect(sidebar(page).getByLabel("Playing from here")).toBeVisible();

		await sidebar(page).getByText(QUERY.text).click();

		await expect(
			page.getByRole("heading", { level: 1, name: QUERY.text }),
		).toBeVisible();
		await expect(page.locator('[role="row"]').first()).toContainText(
			"Los Calientes",
		);
	});

	test("and with no search behind it there is no shelf at all", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toHaveCount(0);
	});
});

test.describe("clearing the search", () => {
	test("takes the scratch playlist with it", async ({ page, player }) => {
		await searchAndPlay(page, player);

		// Stop first: whether the scratch survives is decided from the app's copy of
		// the player state, so clearing before the stop lands reads the old answer.
		await statusBar(page).getByRole("button", { name: "Pause" }).click();
		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();

		// Playing is two requests -- build the playlist, then play from it -- and the
		// poll above only waits for the first, so a stop between them is undone.
		await expect(statusBar(page)).toContainText("Los Calientes");
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

		await page.getByRole("button", { name: "Clear search" }).click();

		await expect.poll(() => scratchOf(player)).toBeUndefined();
	});

	test("but not while the player is still on it", async ({ page, player }) => {
		await searchAndPlay(page, player);

		await page.getByRole("button", { name: "Clear search" }).click();

		// Ordered rather than timed: the field emptying says the handler ran, and a
		// navigation after it says anything it sent has reached the player. Revealed
		// first, since the compact bar puts the field away with the search.
		await revealSearch(page);
		await expect(page.getByLabel("Search your library")).toHaveValue("");
		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();

		// Deleting the playing playlist does not stop playback: the player falls back
		// to another playlist and keeps going.
		expect(scratchOf(player)).toBeDefined();
		expect(scratchOf(player)!.items).toHaveLength(QUERY.matches);
	});
});

test.describe("saving results as a playlist", () => {
	test("saving adopts the playlist the results were already playing from", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		const scratchId = scratchOf(player)!.id;
		const playlistsBefore = player.playlists.length;
		await expect(statusBar(page)).toContainText("Los Calientes");

		await saveAs(page, "Keepers");

		// Matched on id: two unrelated playlists in this fixture hold the same
		// number of tracks.
		const keepers = player.playlists.find(
			(entry) => entry.title === "Keepers",
		)!;
		expect(keepers!.id).toBe(scratchId);
		expect(keepers!.items).toHaveLength(QUERY.matches);
		expect(player.playlists).toHaveLength(playlistsBefore);
		expect(scratchOf(player)).toBeUndefined();

		expect(player.player.activeItem.playlistId).toBe(scratchId);
		await expect(statusBar(page)).toContainText("Los Calientes");
	});

	// Playback inside the scratch is what otherwise keeps the deletion off it, and
	// stopping puts the active item down. Deleting a playlist the play queue points
	// into also takes foobar2000 with it, so this is worse than losing the tracks.
	test("and keeps it once playback has stopped", async ({ page, player }) => {
		await searchAndPlay(page, player);

		// Playing is two requests -- build the playlist, then play from it -- and the
		// poll above only waits for the first, so a stop between them is undone.
		await expect(statusBar(page)).toContainText("Los Calientes");
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

		const scratchId = scratchOf(player)!.id;
		await saveAs(page, "Keepers");

		// Ordered rather than timed: a navigation after the save says anything it
		// sent has reached the player.
		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();

		const keepers = player.playlists.find((entry) => entry.id === scratchId);
		expect(keepers?.title).toBe("Keepers");
		expect(keepers?.items).toHaveLength(QUERY.matches);
	});

	// A ref is only an index into its own source, so copying out of the `Library`
	// autoplaylist by index addresses that library's path-ordered array instead --
	// with no error either way, hence the assertion on the title.
	test("saving results that were never played builds the playlist", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);
		await expectSettlesAt(player, () => scratchOf(player), undefined);
		const playlistsBefore = player.playlists.length;

		await saveAs(page, "Unplayed");

		const saved = player.playlists.find((entry) => entry.title === "Unplayed")!;
		expect(saved!.items).toHaveLength(QUERY.matches);
		expect(player.playlists).toHaveLength(playlistsBefore + 1);

		// Items are the player's own title-formatting rows, so the key is the
		// expression.
		expect(saved!.items[0]["%title%"]).toBe("Los Calientes");

		await expectSettlesAt(player, () => playedFrom(player), null);
		await expectSettlesAt(player, () => scratchOf(player), undefined);
	});

	test("and takes the search out of the sidebar with it", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		await expect(statusBar(page)).toContainText("Los Calientes");

		await saveAs(page, "Keepers");

		await openSidebar(page);
		await expect(sidebar(page).getByText("Keepers")).toBeVisible();
		await expect(sidebar(page).getByText(QUERY.text)).toHaveCount(0);
		await expect(page.getByLabel("Search your library")).toHaveValue("");
	});

	test("a later search does not reclaim the playlist that was saved", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		await expect(statusBar(page)).toContainText("Los Calientes");

		await saveAs(page, "Keepers");
		const keepersId = player.playlists.find(
			(entry) => entry.title === "Keepers",
		)!.id;

		// Adopting leaves the stored id pointing at a playlist that is now the
		// user's. Reusing it without checking would empty their saved playlist.
		await search(page, NARROWER.text);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(NARROWER.matches);

		const keepers = player.playlists.find((entry) => entry.id === keepersId)!;
		expect(keepers!.title).toBe("Keepers");
		expect(keepers!.items).toHaveLength(QUERY.matches);
		expect(scratchOf(player)!.id).not.toBe(keepersId);
	});

	test("saving finishes the search off", async ({ page, player }) => {
		await searchAndPlay(page, player);

		// Playing is two requests -- build the playlist, then play from it -- and the
		// poll above only waits for the first, so a stop between them is undone.
		await expect(statusBar(page)).toContainText("Los Calientes");
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

		await page.getByRole("button", { name: "Save as playlist" }).click();
		await page.getByRole("textbox", { name: "Playlist name" }).fill("Keepers");
		await page.getByRole("button", { name: "Create" }).click();

		await expect(
			page.getByRole("heading", { level: 1, name: "Keepers" }),
		).toBeVisible();
		await expect.poll(() => scratchOf(player)).toBeUndefined();
		await expect(page.getByLabel("Search your library")).toHaveValue("");
	});

	test("opening the form does not carry the header off the top", async ({
		page,
	}) => {
		await search(page, QUERY.text);
		const titleTop = () =>
			page.evaluate(() =>
				Math.round(
					document.querySelector("main h1")!.getBoundingClientRect().top,
				),
			);
		const before = await titleTop();

		await page.getByRole("button", { name: "Save as playlist" }).click();
		await expect(
			page.getByRole("textbox", { name: "Playlist name" }),
		).toBeFocused();

		// Focusing a field the popover puts past the header's bottom edge makes the
		// browser scroll the header inside itself, carrying the title off the top
		// while the page never moves.
		expect(await titleTop()).toBe(before);

		// Clipping the header instead would cut the form off rather than move it.
		const create = page.getByRole("button", { name: "Create" });
		await expect(create).toBeVisible();
		await expect(create).toBeInViewport();
	});
});

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

	test("results still play, in place, and say nothing about shuffle", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);

		await expect(
			viewHeader(page).getByRole("button", { name: "Shuffle" }),
		).toHaveCount(0);

		await trackRow(page, 2).dblclick();

		const libraryId = player.playlists.find(
			(entry) => entry.title === "#Jean Library",
		)!.id;
		await expect.poll(() => playedFrom(player)?.plref).toBe(libraryId);
		expect(playedFrom(player)!.index).toBe(2);
		await expectSettlesAt(player, () => scratchOf(player), undefined);
	});
});

test.describe("a player that reports no permissions at all", () => {
	// Absent is not denied: an older beefweb, or the moment before the first
	// snapshot lands, answers with no permissions object and every reader in the
	// app treats that as allowed.
	test("results keep Shuffle and Save as playlist", async ({
		page,
		player,
	}) => {
		delete (player.player as { permissions?: unknown }).permissions;

		await search(page, QUERY.text);

		const header = viewHeader(page);
		await expect(header.getByRole("button", { name: "Shuffle" })).toBeVisible();
		await expect(
			header.getByRole("button", { name: "Save as playlist" }),
		).toBeVisible();
	});
});

test.describe("marking the row that is playing", () => {
	// The library source identifies a row by `(path, subsong)`, which playlist
	// items do not have -- so only it can mark a track playing from a playlist
	// Jean is not looking at. Index is identity in the autoplaylist fallback, and
	// an index only means anything inside its own playlist.
	test("a track playing from another playlist is still marked in the results", async ({
		page,
		player,
		hasLibraryApi,
	}) => {
		// Rock en Español holds Los Calientes too, and is neither the library nor
		// the scratch.
		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");
		expect(player.player.activeItem.playlistId).toBe("p5");

		await search(page, QUERY.text);

		await expectSettlesAt(player, () => scratchOf(player), undefined);

		const marked = page.locator('[role="row"][data-active="true"]');
		if (!hasLibraryApi) {
			// Without paths there is nothing to match on, so the row stays unmarked.
			await expect(marked).toHaveCount(0);
			return;
		}
		await expect(marked).toHaveCount(1);
		await expect(marked).toContainText("Los Calientes");
	});
});
