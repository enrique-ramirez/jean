import type { Track } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	holdThePoll,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	playedFrom,
	requestsTo,
	revealSearch,
	scratchFills,
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
const SHUFFLE_TRACKS = 4;

const search = async (page: Page, text: string) => {
	await page.goto("/#/search");
	await searchFor(page, text);
	await expect(trackRow(page, 0)).toBeAttached();
};

// Rock en Español holds Los Calientes too, and is neither the library nor the scratch.
const spanishGuid = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title === "Rock en Español")!.guid;

const openSpanish = async (page: Page, player: FakePlayer) => {
	await page.goto(`/#/${spanishGuid(player)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Rock en Español" }),
	).toBeVisible();
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

// Every call that took the rows out of the scratch. Addressed by role rather
// than by id, which is the only address the component accepts for its own.
const scratchEmpties = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "DELETE" &&
			entry.path === "/api/playlists/own/scratch/items",
	);

const saveAsPlaylist = (page: Page) =>
	viewHeader(page).getByRole("button", { name: /Save as playlist/ });

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
		await openLibrary(page);
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

		await expect.poll(() => playedFrom(player)?.id).toBe(scratch!.guid);
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
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)!.guid);
		await expect.poll(() => player.player.playbackMode).toBe(SHUFFLE_TRACKS);
		expect(playedFrom(player)!.index).toBeLessThan(QUERY.matches);
	});

	test("Jean does not show its own scratch playlist anywhere", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		await openSpanish(page, player);

		await openSidebar(page);
		await expect(sidebar(page).getByText("Rock en Español")).toBeVisible();
		await expect(sidebar(page).getByText(QUERY.title)).toHaveCount(0);
	});

	test("and does not offer it as somewhere to file tracks", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		await openSpanish(page, player);

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

		// This client filled the view, so the query comes back from the title it
		// stored rather than from the playlist's. The next test is the other client.
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
		await openLibrary(page);
		await page.evaluate(() => localStorage.clear());
		await openLibrary(page);
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
		await openLibrary(page);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toHaveCount(0);
	});
});

// The scratch playlist's title is not Jean's to trust. foo_jean finds its own
// playlist by the marker it put there rather than by a name, so the name can be
// changed at the player and the role still resolves; and a fill's new title
// reaches a client a message after the playback that moved into it, because
// beefweb may send a `player` section without a `playlists` one. The view Jean
// filled is the answer that survives both, and the two readers of that title
// each have a surface of their own.
test.describe("a scratch playlist under a name that is not the view it holds", () => {
	const renamedAtThePlayer = async (
		page: Page,
		player: FakePlayer,
		title: string,
	) => {
		const scratch = scratchOf(player);
		if (!scratch) throw new Error("nothing filled the scratch playlist");
		player.renamePlaylist(scratch.id, title);

		// Away from the results and reloaded: the committed query is what the
		// search route answers with while it is there, and it outranks both the
		// title and anything Jean remembers.
		await openLibrary(page);
		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	};

	test("the header names the view whose track is playing", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player, NARROWER);
		await renamedAtThePlayer(page, player, QUERY.title);

		await expectPlayingFrom(page, NARROWER.text);
	});

	test("the search comes back to the query whose results are playing", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player, NARROWER);
		await renamedAtThePlayer(page, player, QUERY.title);

		await openSidebar(page);
		const playing = sidebar(page).getByRole("button", {
			name: "Playing from here",
		});
		await expect(playing).toContainText(NARROWER.text);

		await playing.click();
		await expect(
			page.getByRole("heading", { level: 1, name: NARROWER.text }),
		).toBeVisible();
		await expect(page.getByLabel("Search your library")).toHaveValue(
			NARROWER.text,
		);
	});
});

test.describe("clearing the search", () => {
	test("empties the scratch once playback has stopped", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);

		// Stop first: whether the scratch survives is decided from the app's copy of
		// the player state, so clearing before the stop lands reads the old answer.
		await statusBar(page).getByRole("button", { name: "Pause" }).click();
		await openSpanish(page, player);

		// Playing is two requests -- build the playlist, then play from it -- and the
		// poll above only waits for the first, so a stop between them is undone.
		await expect(statusBar(page)).toContainText("Los Calientes");
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

		await page.getByRole("button", { name: "Clear search" }).click();

		await expect.poll(() => scratchOf(player)?.items.length).toBe(0);
	});

	// The stopped case above never makes the guard tell the scratch from anything
	// else: stopped needs no comparison at all, and playing the scratch matches
	// however the check is wired. A guard that simply refused whenever the player
	// had not stopped would pass both. Only moving off the scratch while playback
	// continues forces a real one, which is why both halves are one case here.
	//
	// The scratch is the component's own, so a delete addressed at its id comes
	// back 403 however the read-only-playlists setting is set. Emptying it is the
	// route that exists for this, and it keeps the marker the role resolves
	// through, the playlist's id and its place in the player's own list.
	test("empties the scratch through the component's own route, and leaves its rows alone while it is playing", async ({
		page,
		player,
	}) => {
		const ELSEWHERE = { playlist: "p2", index: 0, title: "Tautou" };

		await searchAndPlay(page, player);
		const scratchId = scratchOf(player)!.id;
		await expect(statusBar(page)).toContainText("Los Calientes");

		await page.getByRole("button", { name: "Clear search" }).click();

		// Ordered rather than timed: the field emptying says the handler ran, so
		// the rows still being there is a decision rather than a race. Revealed
		// first, since the compact bar puts the field away with the search.
		await revealSearch(page);
		await expect(page.getByLabel("Search your library")).toHaveValue("");
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length,
			QUERY.matches,
		);
		expect(scratchEmpties(player)).toHaveLength(0);

		// Off the scratch, with playback carrying on somewhere else: now its rows
		// are Jean's to drop.
		player.playItem(ELSEWHERE.playlist, ELSEWHERE.index);
		await expect(statusBar(page)).toContainText(ELSEWHERE.title);
		await searchFor(page, QUERY.text);

		await page.getByRole("button", { name: "Clear search" }).click();

		await expect.poll(() => scratchEmpties(player).length).toBe(1);
		await expectSettlesAt(player, () => scratchOf(player)?.id, scratchId);
		expect(scratchOf(player)!.items).toHaveLength(0);
	});
});

// The component finds its own playlist by a marker it writes rather than by a
// name, so a rename at the player leaves the role exactly where it was. The
// title is the user's to change, and Jean reads nothing off it: not whether to
// draw the row, and not what to call the set somebody is listening to.
test.describe("a scratch renamed or deleted at the player", () => {
	// Ordinary enough that a client hiding by title would draw it, which is the
	// whole of what this rename is for.
	const RENAMED = "Road trip";

	const idOfPlaylist = (player: FakePlayer, title: string) =>
		player.playlists.find((entry) => entry.title === title)!.id;

	test("a rename keeps it out of the sidebar, and Playing from keeps the name Jean gave it", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player, NARROWER);
		await expect(statusBar(page)).toContainText("Deléctrico");

		player.renamePlaylist(scratchOf(player)!.id, RENAMED);
		// A second rename in the same breath, on a playlist the sidebar does draw.
		// The row carrying its new name is what says the list has been read since,
		// so the two assertions below are about a client that heard rather than one
		// that has not asked yet.
		player.renamePlaylist(idOfPlaylist(player, "Favorites"), "Bangers");

		await openSidebar(page);
		await expect(sidebar(page).getByText("Bangers")).toBeVisible();

		await expect(sidebar(page).getByText(RENAMED)).toHaveCount(0);
		await expectPlayingFrom(page, NARROWER.text);
	});

	test("a deletion clears Playing from and the row it marked, within one poll", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		await expect(statusBar(page)).toContainText("Los Calientes");
		const scratchId = scratchOf(player)!.id;

		await openSidebar(page);
		const playingHere = sidebar(page).getByLabel("Playing from here");
		await expect(playingHere).toBeVisible();

		const poll = await holdThePoll(page);
		expect(player.removePlaylist(scratchId)).toBe(true);
		await poll.untilRefusedAgain();
		// Asked and told nothing, so this is still the screen drawn before the
		// deletion.
		await expect(playingHere).toBeVisible();
		poll.letOneThrough();

		await expect(playingHere).toHaveCount(0);
		// The search entry itself stays: those results are still what is on
		// screen, and nothing about the deletion says otherwise.
		await expect(sidebar(page).getByText(QUERY.text)).toBeVisible();

		await openNowPlaying(page);
		await expect(nowPlayingScreen(page).locator("header")).not.toContainText(
			"Playing from",
		);
	});

	test("a deletion leaves the track playing, says nothing about it, and the next set makes the scratch again", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		await expect(statusBar(page)).toContainText("Los Calientes");
		const scratchId = scratchOf(player)!.id;
		const scratchGuid = scratchOf(player)!.guid;

		expect(player.removePlaylist(scratchId)).toBe(true);

		// Jean has heard: the mark saying the set is playing has gone.
		await openSidebar(page);
		await expect(sidebar(page).getByLabel("Playing from here")).toHaveCount(0);

		expect(player.player.playbackState).toBe("playing");
		await expect(statusBar(page)).toContainText("Los Calientes");
		await expectSettlesAt(player, () => page.getByRole("status").count(), 0);

		await searchFor(page, NARROWER.text);
		await trackRow(page, 0).dblclick();

		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(NARROWER.matches);
		// A GUID foobar2000 never reuses, so this is a playlist that was made
		// rather than the deleted one somehow recovered.
		expect(scratchOf(player)!.guid).not.toBe(scratchGuid);
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)!.guid);
		await expect(statusBar(page)).toContainText("Deléctrico");
	});
});

// Every write the component was asked for under `/api/playlists`, by path. A copy
// or a fill after the create would show up here beside it.
const playlistWrites = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" && entry.path.startsWith("/api/playlists"),
		)
		.map((entry) => entry.path);

const itemsOf = (player: FakePlayer, title: string) =>
	player.playlists.find((entry) => entry.title === title)?.items ?? [];

test.describe("saving results as a playlist", () => {
	// The create carries the rows, so both paths cost the same one job of the
	// player's. Two requests is two chances for the desktop to get between them,
	// and a playlist left half filled is the user's to clean up.
	test("is one request where the scratch is already holding the results", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		// The play is a request of its own after the fill, and `searchAndPlay` waits
		// only for the fill. On a loaded machine it lands the far side of the clear
		// and sits inside the window that is meant to hold the save alone.
		await expectSettlesAt(
			player,
			() => playedFrom(player)?.id,
			scratchOf(player)?.guid,
		);
		player.requests.length = 0;

		await saveAs(page, "Keepers");

		await expectSettlesAt(player, () => playlistWrites(player), [
			"/api/playlists",
		]);
		expect(itemsOf(player, "Keepers")).toHaveLength(QUERY.matches);
	});

	test("is one request where nothing has been played yet", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);
		await expectSettlesAt(player, () => scratchOf(player), undefined);
		player.requests.length = 0;

		await saveAs(page, "Unplayed");

		await expectSettlesAt(player, () => playlistWrites(player), [
			"/api/playlists",
		]);
		expect(itemsOf(player, "Unplayed")).toHaveLength(QUERY.matches);
	});

	test("saving copies the results without disturbing what is already playing", async ({
		page,
		player,
	}) => {
		await searchAndPlay(page, player);
		const scratchId = scratchOf(player)!.id;
		const playlistsBefore = player.playlists.length;
		await expect(statusBar(page)).toContainText("Los Calientes");

		await saveAs(page, "Keepers");

		const keepers = player.playlists.find(
			(entry) => entry.title === "Keepers",
		)!;
		expect(keepers!.id).not.toBe(scratchId);
		expect(keepers!.items).toHaveLength(QUERY.matches);
		expect(player.playlists).toHaveLength(playlistsBefore + 1);
		expect(scratchOf(player)!.id).toBe(scratchId);

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

		await saveAs(page, "Keepers");

		// Ordered rather than timed: a navigation after the save says anything it
		// sent has reached the player.
		await openSpanish(page, player);

		const keepers = player.playlists.find((entry) => entry.title === "Keepers");
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
		// Saving copies rather than taking the scratch over, so the search stays
		// in the sidebar for as long as the scratch itself keeps playing.
		player.stop();
		await expect(statusBar(page)).toContainText("Nothing playing");

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
		// The rows are released, and the playlist holding them is not: it is the
		// component's own and the delete that used to end this is refused now.
		await expect.poll(() => scratchOf(player)?.items.length).toBe(0);
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

// The two writes beefweb would have had to permit to play a set: making the
// scratch playlist, and filling it. Both are the component's now, so neither
// should ever be sent.
const beefwebPlaylistWrites = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			(entry.path.startsWith("/api/playlists/add") ||
				entry.path.includes("add-from-library")),
	);

test.describe("a beefweb permission that says nothing about playing a search result", () => {
	test.use({
		playerState: {
			permissions: {
				changeOutput: true,
				changeClientConfig: true,
			},
		},
	});

	// The scratch playlist is the component's own plumbing, made and filled over
	// its own port, so beefweb's permission governs none of it. The fake honours
	// no beefweb permission either, so a result that plays is not on its own
	// proof that Jean stopped asking beefweb for the playlist to play it from:
	// what the traffic says it asked for is.
	test("a result plays, and nothing beefweb could refuse is sent", async ({
		page,
		player,
	}) => {
		await search(page, QUERY.text);

		const header = viewHeader(page);
		await expect(
			header.getByRole("button", { name: "Play", exact: true }),
		).toBeEnabled();
		await expect(
			header.getByRole("button", { name: "Shuffle", exact: true }),
		).toBeEnabled();

		await trackRow(page, 2).dblclick();

		await expect
			.poll(() => scratchOf(player)?.items.length)
			.toBe(QUERY.matches);
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)!.guid);
		expect(playedFrom(player)!.index).toBe(2);

		await expectSettlesAt(player, () => scratchFills(player).length, 1);
		expect(beefwebPlaylistWrites(player)).toHaveLength(0);
	});

	// Nothing here asks beefweb whether a search may be kept: the playlist is the
	// component's to write, so beefweb's permission is not a reason and the button
	// carries none. Hidden today, which is the gate this is here to keep out.
	test("Save as playlist is drawn and enabled, with no reason to give", async ({
		page,
	}) => {
		await search(page, QUERY.text);

		await expect(saveAsPlaylist(page)).toBeVisible();
		await expect(saveAsPlaylist(page)).toBeEnabled();
		await expect(saveAsPlaylist(page)).not.toHaveAccessibleName(/foo_jean/i);
	});
});

test.describe("where the player owner has turned playlist writes off", () => {
	test.use({ fooJean: { canWritePlaylists: false } });

	// A control that can never be pressed is furniture, and the player owner already
	// knows they set the setting a label would explain to them.
	test("Save as playlist is not drawn at all", async ({ page }) => {
		await search(page, QUERY.text);

		// The header is otherwise whole: what is gone is the one control the setting
		// refuses, not the view around it.
		await expect(
			viewHeader(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
		await expect(saveAsPlaylist(page)).toHaveCount(0);
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
	// Jean is not looking at.
	test("a track playing from another playlist is still marked in the results", async ({
		page,
		player,
	}) => {
		// Rock en Español holds Los Calientes too, and is neither the library nor
		// the scratch.
		await openSpanish(page, player);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");
		expect(player.player.activeItem.playlistId).toBe("p5");

		await search(page, QUERY.text);

		await expectSettlesAt(player, () => scratchOf(player), undefined);

		const marked = page.locator('[role="row"][data-active="true"]');
		await expect(marked).toHaveCount(1);
		await expect(marked).toContainText("Los Calientes");
	});
});

test.describe("a search is an address", () => {
	test("a link straight to a query arrives at its results", async ({
		page,
	}) => {
		await page.goto(`/#/search/${encodeURIComponent(QUERY.text)}`);

		await expect(
			page.getByRole("heading", { level: 1, name: QUERY.text }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
		await expect(page.getByLabel("Search your library")).toHaveValue(
			QUERY.text,
		);
	});

	test("typing one puts it in the address, so a reload comes back to it", async ({
		page,
	}) => {
		await search(page, QUERY.text);
		expect(await page.evaluate(() => location.hash)).toBe(
			`#/search/${encodeURIComponent(QUERY.text)}`,
		);

		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY.text }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
	});

	test("a query with a slash in it survives the round trip", async ({
		page,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, "ac/dc");

		expect(await page.evaluate(() => location.hash)).toBe(
			`#/search/${encodeURIComponent("ac/dc")}`,
		);
		await expect(page.getByLabel("Search your library")).toHaveValue("ac/dc");
	});
});
