import type { RecordedRequest } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	openLibrary,
	pressAndHold,
	refusePlaylistWrites,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";

// Adding goes through the row menu rather than a drag: the menu is the route
// that exists on both surfaces. sidebar.spec.ts covers the drag.

const FAVORITES = { id: "p2", title: "Favorites", itemCount: 7 };
const LIBRARY = "p7";

const toast = (page: Page) => page.getByRole("status");
const titlesIn = (player: FakePlayer, id: string) =>
	player.playlists
		.find((entry) => entry.id === id)!
		.items.map((track) => track["%title%"]);

// A string of decimal digits on the wire, never the fake's own internal number: the requests below
// compare against exactly what the client sent.
const structureOf = (player: FakePlayer, beefwebId: string) =>
	String(player.playlists.find((entry) => entry.id === beefwebId)!.structure);

// The component is cross-origin, so a write also logs the preflight it answered with a 204:
// counting every request matching the path counts that too.
const postsTo = (player: FakePlayer, pattern: string) =>
	requestsTo(player, pattern).filter((entry) => entry.method === "POST");

// Reads of the playlist collection alone, which is where an item count comes from.
const listReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "GET" && entry.path === "/api/playlists",
	);

// Anything a copy or a removal could have been built from, before it went out: a
// read of the playlist collection, which is the only place an item count lives,
// and any playlist write. A page of rows for the view on screen is neither, and
// belongs to the list somebody is looking at rather than to the edit. Preflights
// are the browser's own.
const countReadsAndWritesBefore = (
	player: FakePlayer,
	request: RecordedRequest,
) =>
	player.requests
		.slice(0, player.requests.indexOf(request))
		.filter(
			(entry) =>
				entry.path === "/api/playlists" ||
				(entry.method === "POST" && entry.path.startsWith("/api/playlists/")),
		)
		.map((entry) => `${entry.method} ${entry.path}`);

// Right-click on a pointer, press-and-hold on touch: the same menu, asked for
// the way each surface asks for it.
const openRowMenu = async (page: Page, index: number, isMobile: boolean) => {
	const target = trackRow(page, index);
	if (isMobile) await pressAndHold(page, target);
	else await target.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "Add to playlist" }),
	).toBeVisible();
};

const addToFavorites = async (page: Page, index: number, isMobile: boolean) => {
	await openRowMenu(page, index, isMobile);
	await page.getByRole("menuitem", { name: "Add to playlist" }).click();
	await page
		.getByRole("menuitem", { name: FAVORITES.title, exact: true })
		.click();
};

// An autoplaylist, which the API gives no way to recognise: PlaylistInfo says
// nothing about it and the write comes back 204 either way. The fake refuses it
// as the player does, by accepting it and doing nothing. See `useAddTracks`.
const AUTO = { id: "p9", title: "Recently Added", itemCount: 5 };

const addTo = async (
	page: Page,
	index: number,
	isMobile: boolean,
	title: string,
) => {
	await openRowMenu(page, index, isMobile);
	await page.getByRole("menuitem", { name: "Add to playlist" }).click();
	await page.getByRole("menuitem", { name: title, exact: true }).click();
};

test.describe("a playlist that takes the write and ignores it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("says so, rather than claiming the tracks landed", async ({
		page,
		player,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		// The request is sent and answers 204; there is no way to know beforehand.
		await expect
			.poll(() => requestsTo(player, "/items/").length)
			.toBeGreaterThan(0);

		await expect(toast(page)).toContainText(AUTO.title);
		await expect(toast(page)).toContainText("Nothing was added to");
		expect(titlesIn(player, AUTO.id)).toHaveLength(AUTO.itemCount);
	});

	test("offers no undo, because there is nothing to take off", async ({
		page,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		await expect(toast(page)).toContainText("Nothing was added to");
		await expect(toast(page).getByRole("button", { name: "Undo" })).toHaveCount(
			0,
		);
	});

	// The other cause a refusal can have is foo_jean's `writePlaylists`, which is
	// on here and permits the write. One message covering both would read as a
	// setting to go and change, and there is nothing to change: this playlist would
	// ignore the write whatever the player owner does.
	test("says nothing about a setting that is not what stopped it", async ({
		page,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		await expect(toast(page)).toContainText("Nothing was added to");
		await expect(toast(page)).not.toHaveText(/foo_jean/i);
	});

	test("the playlist that does take them still says the true thing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, FAVORITES.title);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();
		await expect
			.poll(() => titlesIn(player, FAVORITES.id).length)
			.toBe(FAVORITES.itemCount + 1);
	});
});

test.describe("adding tracks to a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it says what happened, because you are not looking at it", async ({
		page,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();
	});

	// A copy answers where the rows landed and the generation they landed at, so
	// there is nothing left for a count to say. Reading one either side of the write
	// costs two round trips on the path a user waits through, and the answer is stale
	// the moment the desktop touches the playlist.
	test("the copy is the only thing sent, with no item count read around it", async ({
		page,
		player,
		isMobile,
	}) => {
		// The list the view was drawn from has to be in the log before it is emptied,
		// or the load's own read lands inside the window and is counted against the
		// copy. Nothing here moves the playlists revision, so once it has landed the
		// poll asks for the list again only when the copy moves it.
		await expectSettlesAt(player, () => listReads(player).length > 0, true);
		player.requests.length = 0;

		await addToFavorites(page, 0, isMobile);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/copy").length,
			1,
		);
		expect(
			countReadsAndWritesBefore(player, postsTo(player, "/items/copy")[0]),
		).toEqual([]);

		// The one read left is the poll catching up with the playlists revision the
		// copy moved, which every client on the network gets whoever did the writing.
		await expectSettlesAt(player, () => listReads(player).length, 1);
	});

	test("a selection copies in one request, not one per track", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][data-selected="true"]'),
		).toHaveCount(3);

		await addToFavorites(page, 1, isMobile);

		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/copy").length,
			1,
		);
		const copy = postsTo(player, "/items/copy")[0];
		expect(copy.path).toBe(
			`/api/playlists/${guidOfPlaylist(player, FAVORITES.id)}/items/copy`,
		);
		expect(copy.body).toEqual({
			source: guidOfPlaylist(player, LIBRARY),
			runs: [[0, 3]],
		});

		await expect(toast(page)).toContainText(
			`Added 3 tracks to ${FAVORITES.title}`,
		);
	});
});

test.describe("undoing it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it takes off exactly what was put on", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, FAVORITES.id);

		await addToFavorites(page, 0, isMobile);
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 1);

		const structureAfterAdd = structureOf(player, FAVORITES.id);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		// The appended range, computed from the itemCount already in PlaylistInfo:
		// no %path% fetched, no matching, one request.
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(postsTo(player, "/items/remove")[0].body).toEqual({
			structure: structureAfterAdd,
			runs: [[FAVORITES.itemCount, 1]],
		});

		// Titles rather than a count: removing the first track instead of the last
		// would leave the count right and the playlist wrong.
		await expect.poll(() => titlesIn(player, FAVORITES.id)).toEqual(before);
	});

	test("a multi-track add comes off in one piece", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		const before = titlesIn(player, FAVORITES.id);

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await addToFavorites(page, 1, isMobile);
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 3);

		const structureAfterAdd = structureOf(player, FAVORITES.id);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(postsTo(player, "/items/remove")[0].body).toEqual({
			structure: structureAfterAdd,
			runs: [[7, 3]],
		});
		await expect.poll(() => titlesIn(player, FAVORITES.id)).toEqual(before);
	});

	// A rating, a play count or a retag moves the playlist's content revision and
	// leaves its rows where they are. The undo is addressed by the structure
	// generation the copy answered, so none of that is in its way.
	test("a rating written in the target since does not stop it", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, FAVORITES.id);

		await addToFavorites(page, 0, isMobile);
		await expect
			.poll(() => titlesIn(player, FAVORITES.id).length)
			.toBe(FAVORITES.itemCount + 1);

		// `retagPlaying` is the fake's only content change that leaves a row where it
		// is, so the row that changes has to be the playing one.
		const caughtUp = listReads(player).length;
		player.playItem(FAVORITES.id, 0);
		player.retagPlaying({ "%rating%": "4" });

		// Both of those move the playlists revision, and the poll answers by reading
		// the list. Waiting for that read keeps it out of the window below, where it
		// would look like Jean counting the rows before removing any.
		await expect.poll(() => listReads(player).length).toBeGreaterThan(caughtUp);

		player.requests.length = 0;
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect.poll(() => titlesIn(player, FAVORITES.id)).toEqual(before);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(
			countReadsAndWritesBefore(player, postsTo(player, "/items/remove")[0]),
		).toEqual([]);
	});

	// The indices are only ours while nothing else has touched the playlist, and
	// the desktop is a second writer Jean cannot see coming.
	test("it abandons itself when the playlist changed underneath", async ({
		page,
		player,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();

		// foobar2000 on the desktop, adding two tracks of its own while the toast
		// is still on screen. Now [7] is somebody else's track.
		await page.request.post("/__control/append", {
			data: { sourceId: LIBRARY, targetId: FAVORITES.id, items: [20, 21] },
		});
		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
			)
			.toHaveLength(FAVORITES.itemCount + 3);

		const after = titlesIn(player, FAVORITES.id);
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect(toast(page)).toContainText(
			`${FAVORITES.title} has changed since then`,
		);

		// The component is what notices. Nothing here reads the playlist first, so the
		// removal goes out against the generation the copy answered, comes back 409,
		// and takes nothing off: a check made in the player cannot be raced.
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(titlesIn(player, FAVORITES.id)).toEqual(after);
	});

	test("the toast can be dismissed without undoing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addToFavorites(page, 0, isMobile);
		await expect(toast(page)).toBeVisible();

		await toast(page).getByRole("button", { name: "Dismiss" }).click();
		await expect(toast(page)).toHaveCount(0);

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			0,
		);
		expect(
			player.playlists.find((entry) => entry.id === FAVORITES.id)!.items,
		).toHaveLength(FAVORITES.itemCount + 1);
	});
});

// The other refusal an add can meet, and the only one with a remedy: the player
// owner holds this switch in the component's own preferences. Saying a smart
// playlist swallowed the tracks would send them looking at the playlist instead.
test.describe("an add the component refuses outright", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	// `writePlaylists` by name, because a setting is only actionable if the message
	// spells what to go and look for. The component's own 403 already says it: Jean
	// standing in front of that answer must not say less than it does.
	test("names writePlaylists, and blames no smart playlist", async ({
		page,
		isMobile,
	}) => {
		await refusePlaylistWrites(page);

		await addToFavorites(page, 0, isMobile);

		await expect(toast(page)).toContainText("writePlaylists");
		await expect(toast(page)).not.toContainText(/smart playlist/i);
	});
});

test.describe("what does not get a toast", () => {
	test("creating a playlist says nothing, because the row is right there", async ({
		page,
	}) => {
		await openLibrary(page);

		const sidebar = page.getByRole("navigation", { name: "Playlists" });
		if (!(await sidebar.isVisible())) {
			await page.getByRole("button", { name: "Show playlists" }).click();
		}

		await page.getByRole("button", { name: "New playlist" }).click();
		await expect(
			page.getByRole("textbox", { name: "Rename New playlist" }),
		).toBeFocused();

		await expect(toast(page)).toHaveCount(0);
	});
});
