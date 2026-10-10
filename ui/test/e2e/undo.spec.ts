import type { APIRequestContext } from "@playwright/test";
import { en } from "../../src/shared/i18n/en.ts";
import type { RecordedRequest } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	componentOrigin,
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	openAllMusic,
	openLibrary,
	pressAndHold,
	refusePlaylistWrites,
	requestsTo,
	rowByTitle,
	scrollUntilMounted,
	test,
	times,
	titlesIn,
	trackRow,
} from "./fixtures.ts";

// Adding goes through the row menu rather than a drag: the menu is the route
// that exists on both surfaces. sidebar.spec.ts covers the drag.

// A playlist holding none of the library playlist's first rows, so an add from there lands whole.
const TARGET = { id: "p1", title: "Default Playlist", itemCount: 4 };
const LIBRARY = "p7";

const toast = (page: Page) => page.getByRole("status");

// A string of decimal digits on the wire, never the fake's own internal number: the requests below
// compare against exactly what the client sent.
const structureOf = (player: FakePlayer, key: string) =>
	String(player.playlists.find((entry) => entry.id === key)!.structure);

const postsTo = (player: FakePlayer, pattern: string) =>
	requestsTo(player, pattern).filter((entry) => entry.method === "POST");

// The route a library view adds through, which is not the copy: it names library ordinals
// against the library's own generation rather than a source playlist's rows.
const fillsInto = (player: FakePlayer, guid: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" && entry.path === `/api/playlists/${guid}/items`,
	);

// Reads of the playlist collection alone, which is where an item count comes from.
const listReads = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "GET" && entry.path === "/api/playlists",
	);

// Anything a copy or a removal could have been built from, before it went out: a
// read of the playlist collection, which is the only place an item count lives,
// and any playlist write. A page of rows for the view on screen is neither, and
// belongs to the list somebody is looking at rather than to the edit.
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

const addToTarget = async (page: Page, index: number, isMobile: boolean) => {
	await openRowMenu(page, index, isMobile);
	await page.getByRole("menuitem", { name: "Add to playlist" }).click();
	await page.getByRole("menuitem", { name: TARGET.title, exact: true }).click();
};

// An autoplaylist; `useAddTracks.ts`'s top comment has what a lock on it means for a write.
const AUTO = { id: "p9", title: "Recently Added", itemCount: 5 };

// Spelled out rather than read from the catalogue: "autoplaylist" is the one word Jean uses for a
// playlist foobar2000 fills from a query, and the sentence a person reads is what is promised.
const AUTO_REFUSED = `Nothing was added to ${AUTO.title}. Autoplaylists fill themselves and cannot be added to.`;

// What the component answers an edit the player refused for a lock: `PlaylistLocked` and
// `FillConflict` in `contract/openapi.yaml`, which publish the same two fields.
const LOCKED = {
	error: "another component has locked that playlist against that edit",
	detail: "",
};

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

// How a copy was answered, which the request log cannot say: it holds what was asked of the
// player and not what came back.
const copyStatuses = (page: Page) => {
	const answered: number[] = [];
	page.on("response", (response) => {
		if (response.url().includes("/items/copy"))
			answered.push(response.status());
	});
	return answered;
};

const lockPlaylistAtThePlayer = async (page: Page, key: string) => {
	const answered = await page.request.post("/__control/lockPlaylist", {
		data: { id: key, locked: true },
	});
	expect(
		answered.ok(),
		"the fake needs a control that locks a playlist against edits mid-test",
	).toBe(true);
};

// A playlist write that failed rather than one the player refused: a 500, a connection that
// died, a playlist deleted at the player between the menu opening and the click. Shaped like
// `/__control/state`'s `failState`, and turned off by leaving the status out.
const failPlaylistWritesAtThePlayer = async (page: Page, status: number) => {
	const answered = await page.request.post("/__control/failPlaylistWrites", {
		data: { status },
	});
	expect(
		answered.ok(),
		"the fake needs a control that fails a playlist write mid-test",
	).toBe(true);
};

test.describe("an add into a playlist the player has locked", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("says nothing was added, where the copy came back refused", async ({
		page,
		player,
		isMobile,
	}) => {
		const answered = copyStatuses(page);

		await addTo(page, 0, isMobile, AUTO.title);

		// The request is sent and refused; there is no way to know beforehand.
		await expect.poll(() => answered).toEqual([409]);

		await expect(toast(page)).toContainText(AUTO.title);
		await expect(toast(page)).toContainText(AUTO_REFUSED);
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
	// setting to go and change, and there is nothing to change: the player holds
	// this playlist whatever the player owner does with that switch.
	test("says nothing about a setting that is not what stopped it", async ({
		page,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, AUTO.title);

		await expect(toast(page)).toContainText("Nothing was added to");
		await expect(toast(page)).not.toHaveText(/foo_jean/i);
	});

	// An ordinary playlist, refused by a lock some other component took. Jean knows the lock
	// and not what took it, so a message about autoplaylists sends somebody to look at a
	// playlist that is nothing of the kind, and one about `writePlaylists` sends them to a
	// switch that is on.
	test("names no autoplaylist where the lock is another component's", async ({
		page,
		player,
		isMobile,
	}) => {
		await lockPlaylistAtThePlayer(page, TARGET.id);
		const answered = copyStatuses(page);

		await addTo(page, 0, isMobile, TARGET.title);

		await expect.poll(() => answered).toEqual([409]);

		await expect(toast(page)).toContainText(TARGET.title);
		await expect(toast(page)).not.toContainText(/autoplaylist/i);
		await expect(toast(page)).not.toContainText(/writePlaylists/i);
		await expect(toast(page).getByRole("button", { name: "Undo" })).toHaveCount(
			0,
		);
		expect(titlesIn(player, TARGET.id)).toHaveLength(TARGET.itemCount);
	});

	test("the playlist that does take them still says the true thing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addTo(page, 0, isMobile, TARGET.title);

		await expect(toast(page)).toContainText(`Added 1 track to ${TARGET.title}`);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();
		await expect
			.poll(() => titlesIn(player, TARGET.id).length)
			.toBe(TARGET.itemCount + 1);
	});
});

test.describe("adding tracks to a playlist", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it says what happened, because you are not looking at it", async ({
		page,
		isMobile,
	}) => {
		await addToTarget(page, 0, isMobile);

		await expect(toast(page)).toContainText(`Added 1 track to ${TARGET.title}`);
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

		await addToTarget(page, 0, isMobile);

		await expect(toast(page)).toContainText(`Added 1 track to ${TARGET.title}`);
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

		await addToTarget(page, 1, isMobile);

		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/copy").length,
			1,
		);
		const copy = postsTo(player, "/items/copy")[0];
		expect(copy.path).toBe(
			`/api/playlists/${guidOfPlaylist(player, TARGET.id)}/items/copy`,
		);
		expect(copy.body).toEqual({
			source: guidOfPlaylist(player, LIBRARY),
			runs: [[0, 3]],
			duplicates: "skip",
		});

		await expect(toast(page)).toContainText(
			`Added 3 tracks to ${TARGET.title}`,
		);
	});
});

// foobar2000 playlists are ordered lists, not sets, so a track already in one may go in again. Jean
// asks first and never decides: the tracks the target lacks land at once, and the ones it holds
// wait for an answer. Both ways an add is made, a copy out of a playlist and a fill from a library
// view.
const SPANISH = { id: "p5", title: "Rock en Español" };
const HELD = "Los Calientes";

const question = (page: Page) => page.getByRole("alertdialog");

for (const [view, open] of [
	["a playlist", openLibrary],
	["a library view", openAllMusic],
] as const) {
	test.describe(`adding from ${view} a track the target already holds`, () => {
		let held: string[];

		test.beforeEach(async ({ page, player, isMobile }) => {
			held = titlesIn(player, SPANISH.id);
			expect(held, `${SPANISH.title} already holds ${HELD}`).toContain(HELD);

			await open(page);
			const row = rowByTitle(page, HELD);
			await scrollUntilMounted(page, row);
			if (isMobile) await pressAndHold(page, row);
			else await row.click({ button: "right" });
			await page.getByRole("menuitem", { name: "Add to playlist" }).click();
			await page
				.getByRole("menuitem", { name: SPANISH.title, exact: true })
				.click();

			await expect(question(page)).toContainText(
				`${HELD} is already in ${SPANISH.title}.`,
			);
		});

		test("asks before adding it again, having added nothing", async ({
			player,
		}) => {
			expect(titlesIn(player, SPANISH.id)).toEqual(held);
		});

		test("Skip leaves the playlist as it was and says nothing", async ({
			page,
			player,
		}) => {
			await question(page).getByRole("button", { name: "Skip" }).click();

			await expect(question(page)).toHaveCount(0);
			await expect(toast(page)).toBeEmpty();
			await expectSettlesAt(player, () => titlesIn(player, SPANISH.id), held);
		});

		test("Add anyway puts it in again", async ({ page, player }) => {
			await question(page).getByRole("button", { name: "Add anyway" }).click();

			await expect(toast(page)).toContainText(
				`Added 1 track to ${SPANISH.title}`,
			);
			await expectSettlesAt(player, () => titlesIn(player, SPANISH.id), [
				...held,
				HELD,
			]);
		});
	});
}

// The first three rows of the library playlist: Favorites holds the first two and lacks the third.
// It holds none of the rows a library view opens on.
const FAVORITES = { id: "p2", title: "Favorites", itemCount: 7 };

test.describe("adding a selection the target holds part of", () => {
	const FRESH = "Deléctrico";
	const ALREADY = ["Los Calientes", "Fizz"];

	let before: string[];

	test.beforeEach(async ({ page, player, isMobile }) => {
		test.skip(isMobile, "building a selection needs Shift and a pointer");

		before = titlesIn(player, FAVORITES.id);
		expect(before).not.toContain(FRESH);
		for (const title of ALREADY) expect(before).toContain(title);

		await openLibrary(page);
		await trackRow(page, 0).click();
		await trackRow(page, 2).click({ modifiers: ["Shift"] });
		await addTo(page, 1, isMobile, FAVORITES.title);

		await expect(question(page)).toContainText(
			`2 tracks are already in ${FAVORITES.title}.`,
		);
	});

	test("the tracks it lacks land without waiting for the answer", async ({
		player,
	}) => {
		await expect
			.poll(() => titlesIn(player, FAVORITES.id))
			.toEqual([...before, FRESH]);
	});

	test("Skip keeps only those, and says how many went in", async ({
		page,
		player,
	}) => {
		await question(page).getByRole("button", { name: "Skip" }).click();

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expectSettlesAt(player, () => titlesIn(player, FAVORITES.id), [
			...before,
			FRESH,
		]);
	});

	test("Add anyway adds the rest, and one Undo takes all of it back off", async ({
		page,
		player,
	}) => {
		await question(page).getByRole("button", { name: "Add anyway" }).click();

		await expect(toast(page)).toContainText(
			`Added 3 tracks to ${FAVORITES.title}`,
		);
		await expect
			.poll(() => titlesIn(player, FAVORITES.id))
			.toEqual([...before, FRESH, ...ALREADY]);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expectSettlesAt(player, () => titlesIn(player, FAVORITES.id), before);
	});
});

test.describe("undoing it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it takes off exactly what was put on", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, TARGET.id);

		await addToTarget(page, 0, isMobile);
		await expect
			.poll(
				() => player.playlists.find((entry) => entry.id === TARGET.id)!.items,
			)
			.toHaveLength(TARGET.itemCount + 1);

		const structureAfterAdd = structureOf(player, TARGET.id);

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
			runs: [[TARGET.itemCount, 1]],
		});

		// Titles rather than a count: removing the first track instead of the last
		// would leave the count right and the playlist wrong.
		await expect.poll(() => titlesIn(player, TARGET.id)).toEqual(before);
	});

	test("a multi-track add comes off in one piece", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "building a selection needs Shift and the arrows");

		const before = titlesIn(player, TARGET.id);

		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await addToTarget(page, 1, isMobile);
		await expect
			.poll(
				() => player.playlists.find((entry) => entry.id === TARGET.id)!.items,
			)
			.toHaveLength(TARGET.itemCount + 3);

		const structureAfterAdd = structureOf(player, TARGET.id);

		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(postsTo(player, "/items/remove")[0].body).toEqual({
			structure: structureAfterAdd,
			runs: [[4, 3]],
		});
		await expect.poll(() => titlesIn(player, TARGET.id)).toEqual(before);
	});

	// A rating, a play count or a retag moves the playlist's content revision and
	// leaves its rows where they are. The undo is addressed by the structure
	// generation the copy answered, so none of that is in its way.
	test("a rating written in the target since does not stop it", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, TARGET.id);

		await addToTarget(page, 0, isMobile);
		await expect
			.poll(() => titlesIn(player, TARGET.id).length)
			.toBe(TARGET.itemCount + 1);

		// `retagPlaying` is the fake's only content change that leaves a row where it
		// is, so the row that changes has to be the playing one.
		const caughtUp = listReads(player).length;
		player.playItem(TARGET.id, 0);
		player.retagPlaying({ "%rating%": "4" });

		// Both of those move the playlists revision, and the poll answers by reading
		// the list. Waiting for that read keeps it out of the window below, where it
		// would look like Jean counting the rows before removing any.
		await expect.poll(() => listReads(player).length).toBeGreaterThan(caughtUp);

		player.requests.length = 0;
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect.poll(() => titlesIn(player, TARGET.id)).toEqual(before);
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
		await addToTarget(page, 0, isMobile);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();

		// foobar2000 on the desktop, adding two tracks of its own while the toast
		// is still on screen. Now [7] is somebody else's track.
		await page.request.post("/__control/append", {
			data: { sourceId: LIBRARY, targetId: TARGET.id, items: [20, 21] },
		});
		await expect
			.poll(
				() => player.playlists.find((entry) => entry.id === TARGET.id)!.items,
			)
			.toHaveLength(TARGET.itemCount + 3);

		const after = titlesIn(player, TARGET.id);
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect(toast(page)).toContainText(
			`${TARGET.title} has changed since then`,
		);

		// The component is what notices. Nothing here reads the playlist first, so the
		// removal goes out against the generation the copy answered, comes back 409,
		// and takes nothing off: a check made in the player cannot be raced.
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(titlesIn(player, TARGET.id)).toEqual(after);
	});

	test("the toast can be dismissed without undoing", async ({
		page,
		player,
		isMobile,
	}) => {
		await addToTarget(page, 0, isMobile);
		await expect(toast(page)).not.toBeEmpty();

		await toast(page).getByRole("button", { name: "Dismiss" }).click();
		await expect(toast(page)).toBeEmpty();

		await expectSettlesAt(
			player,
			() => requestsTo(player, "/items/remove").length,
			0,
		);
		expect(
			player.playlists.find((entry) => entry.id === TARGET.id)!.items,
		).toHaveLength(TARGET.itemCount + 1);
	});
});

const CLOCK_STEP_MS = 250;

const runClockFor = (page: Page, ms: number) =>
	times(Math.ceil(ms / CLOCK_STEP_MS), () => page.clock.runFor(CLOCK_STEP_MS));

const LONGER_THAN_A_TOAST_LIVES_MS = 15_000;

// Screen readers announce what changes inside a live region that was already on the page, and
// read one that arrives already holding its first toast unreliably or not at all (WAI-ARIA 1.2,
// aria-live). So the region is on the page from the start, and a toast somebody is reading
// waits for them (WCAG 2.2.1, Timing Adjustable).
test.describe("saying it", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("the region a toast is said in is on the page before anything is said", async ({
		page,
	}) => {
		await expect(toast(page)).toHaveCount(1);
		await expect(toast(page)).toBeEmpty();
	});

	test("a toast waits while the pointer rests on it, and goes once it leaves", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a finger does not rest on a toast");

		await page.clock.install();
		await addToTarget(page, 0, isMobile);
		const undo = toast(page).getByRole("button", { name: "Undo" });
		await expect(undo).toBeVisible();

		await toast(page).getByText(TARGET.title).hover();
		await runClockFor(page, LONGER_THAN_A_TOAST_LIVES_MS);
		await expect(undo).toBeVisible();

		await page.mouse.move(0, 0);
		await runClockFor(page, LONGER_THAN_A_TOAST_LIVES_MS);
		await expect(toast(page)).toBeEmpty();
	});

	test("a toast waits while focus is inside it, and goes once focus leaves", async ({
		page,
		isMobile,
	}) => {
		await page.clock.install();
		await addToTarget(page, 0, isMobile);
		const undo = toast(page).getByRole("button", { name: "Undo" });
		await undo.focus();

		await runClockFor(page, LONGER_THAN_A_TOAST_LIVES_MS);
		await expect(undo).toBeFocused();

		await undo.blur();
		await runClockFor(page, LONGER_THAN_A_TOAST_LIVES_MS);
		await expect(toast(page)).toBeEmpty();
	});
});

// Every case above starts from a playlist, so the write is the copy. A library view
// writes through the fill instead, which is a different route with a different answer,
// and the undo hanging off it is the same promise.
test.describe("undoing an add made from a library view", () => {
	test.beforeEach(({ page }) => openAllMusic(page));

	test("the fill is the only thing sent, with no item count read around it", async ({
		page,
		player,
		isMobile,
	}) => {
		await expectSettlesAt(player, () => listReads(player).length > 0, true);
		player.requests.length = 0;

		await addTo(page, 0, isMobile, FAVORITES.title);

		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		const target = guidOfPlaylist(player, FAVORITES.id);
		await expectSettlesAt(player, () => fillsInto(player, target).length, 1);
		expect(
			countReadsAndWritesBefore(player, fillsInto(player, target)[0]),
		).toEqual([]);

		// The one read left is the poll catching up with the playlists revision the
		// fill moved, which every client on the network gets whoever did the writing.
		await expectSettlesAt(player, () => listReads(player).length, 1);
	});

	// The generation the fill landed at is the only thing that can address those rows.
	// Refetching one at undo time reads whatever the desktop has since made true, and a
	// removal sent against that is accepted and takes off somebody else's rows.
	test("it abandons itself when the playlist changed underneath", async ({
		page,
		player,
		isMobile,
	}) => {
		await expectSettlesAt(player, () => listReads(player).length > 0, true);
		await addTo(page, 0, isMobile, FAVORITES.title);
		await expect(toast(page)).toContainText(
			`Added 1 track to ${FAVORITES.title}`,
		);
		await expect(
			toast(page).getByRole("button", { name: "Undo" }),
		).toBeVisible();

		// foobar2000 on the desktop, adding two tracks of its own while the toast is
		// still on screen.
		await page.request.post("/__control/append", {
			data: { sourceId: LIBRARY, targetId: FAVORITES.id, items: [20, 21] },
		});
		await expect
			.poll(() => titlesIn(player, FAVORITES.id).length)
			.toBe(FAVORITES.itemCount + 3);

		const after = titlesIn(player, FAVORITES.id);
		await toast(page).getByRole("button", { name: "Undo" }).click();

		await expect(toast(page)).toContainText(
			en["add.undoStale"].replace("{playlist}", FAVORITES.title),
		);
		await expectSettlesAt(
			player,
			() => postsTo(player, "/items/remove").length,
			1,
		);
		expect(titlesIn(player, FAVORITES.id)).toEqual(after);
	});

	// The other half of the same sentence: a generation named verbatim is not a refusal
	// to undo anything. A rating moves the content revision and leaves every row where
	// it is, so it is not in the way.
	test("a rating written in the target since does not stop it", async ({
		page,
		player,
		isMobile,
	}) => {
		const before = titlesIn(player, FAVORITES.id);

		await addTo(page, 0, isMobile, FAVORITES.title);
		await expect
			.poll(() => titlesIn(player, FAVORITES.id).length)
			.toBe(FAVORITES.itemCount + 1);

		// `retagPlaying` is the fake's only content change that leaves a row where it
		// is, so the row that changes has to be the playing one.
		const caughtUp = listReads(player).length;
		player.playItem(FAVORITES.id, 0);
		player.retagPlaying({ "%rating%": "4" });
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
});

// The other refusal an add can meet, and the only one with a remedy: the player
// owner holds this switch in the component's own preferences. Saying an autoplaylist
// swallowed the tracks would send them looking at the playlist instead.
test.describe("an add the component refuses outright", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	// `writePlaylists` by name, because a setting is only actionable if the message
	// spells what to go and look for. The component's own 403 already says it: Jean
	// standing in front of that answer must not say less than it does.
	test("names writePlaylists, and blames no autoplaylist", async ({
		page,
		isMobile,
	}) => {
		await refusePlaylistWrites(page);

		await addToTarget(page, 0, isMobile);

		await expect(toast(page)).toContainText("writePlaylists");
		await expect(toast(page)).not.toContainText(/autoplaylist/i);
	});
});

test.describe("an add that failed rather than being refused", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	// Nothing came back that says why, so there is no cause to report and none to borrow. The
	// two causes Jean can name belong to answers it did not get: an autoplaylist is the 409
	// from a playlist the player builds, and `writePlaylists` is the 403.
	test("names the playlist and no cause, where the copy simply failed", async ({
		page,
		player,
		isMobile,
	}) => {
		await failPlaylistWritesAtThePlayer(page, 500);
		const answered = copyStatuses(page);

		await addTo(page, 0, isMobile, TARGET.title);

		await expect.poll(() => answered).toEqual([500]);

		await expect(toast(page)).toContainText(TARGET.title);
		await expect(toast(page)).not.toContainText(/autoplaylist/i);
		await expect(toast(page)).not.toContainText(/writePlaylists/i);
		await expect(toast(page).getByRole("button", { name: "Undo" })).toHaveCount(
			0,
		);
		expect(titlesIn(player, TARGET.id)).toHaveLength(TARGET.itemCount);
	});
});

// Asked of the fake directly, because what is under test is the fake's fidelity to the player
// rather than anything Jean draws, and every case above rests on it. foobar2000 refuses rows
// into a locked playlist and leaves its row count where it was; both routes that add rows
// consult the lock, so both answer the same 409.
test.describe("what the player answers an edit it holds the lock on", () => {
	const copyInto = (
		request: APIRequestContext,
		origin: string,
		player: FakePlayer,
		target: string,
	) =>
		request.post(
			`${origin}/api/playlists/${guidOfPlaylist(player, target)}/items/copy`,
			{
				data: { source: guidOfPlaylist(player, LIBRARY), runs: [[0, 3]] },
			},
		);

	test("refuses a copy into an autoplaylist, in the words the contract publishes", async ({
		request,
		player,
	}) => {
		const origin = await componentOrigin(request);

		const refused = await copyInto(request, origin, player, AUTO.id);

		expect(refused.status()).toBe(409);
		expect(await refused.json()).toEqual(LOCKED);
		expect(titlesIn(player, AUTO.id)).toHaveLength(AUTO.itemCount);
	});

	test("refuses a fill into an autoplaylist, rather than answering rows it did not add", async ({
		request,
		player,
	}) => {
		const origin = await componentOrigin(request);
		const built = await request.get(
			`${origin}/api/library/export?columns=${encodeURIComponent("%title%")}`,
		);
		expect(built.status()).toBe(200);
		const { library } = await (await request.get(`${origin}/api/state`)).json();

		const refused = await request.post(
			`${origin}/api/playlists/${guidOfPlaylist(player, AUTO.id)}/items`,
			{
				data: { structure: library.structure, ordinals: [0, 1, 2] },
			},
		);

		expect(refused.status()).toBe(409);
		expect(await refused.json()).toEqual(LOCKED);
		expect(titlesIn(player, AUTO.id)).toHaveLength(AUTO.itemCount);
	});

	test("takes the same copy into a playlist nothing holds", async ({
		request,
		player,
	}) => {
		const origin = await componentOrigin(request);

		const taken = await copyInto(request, origin, player, TARGET.id);

		expect(taken.status()).toBe(200);
		expect((await taken.json()).positions).toEqual([4, 5, 6]);
		expect(titlesIn(player, TARGET.id)).toHaveLength(TARGET.itemCount + 3);
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

		await expect(toast(page)).toBeEmpty();
	});
});
