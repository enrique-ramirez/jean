import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	openSidebar,
	pressAndHold,
	requestsTo,
	scrollUntilMounted,
	sidebar,
	test,
	trackRow,
} from "./fixtures.ts";

// The captured playlists, in the order the fake serves them. Ids are not
// contiguous and not in index order, which is what the real install looks like
// -- so a reorder assertion that quietly assumed p1 p2 p3 would pass here and
// fail on someone's machine.
const DEFAULT_PLAYLIST = "Default Playlist";
const LIBRARY = "Library";
const FAVORITES = "Favorites";
const SPANISH = "Rock en Español";

// Rows are direct children of the nav; so is the section header, hence the
// filter. The row rather than the button inside it, because the drop target,
// the drag gesture and the grip all live on the row.
const row = (page: Page, title: string) =>
	sidebar(page).locator("> div").filter({ hasText: title });
const link = (page: Page, title: string) =>
	row(page, title).getByRole("button").first();

const titlesInOrder = (player: FakePlayer) =>
	player.playlists.map((entry) => entry.title);

const openApp = async (page: Page) => {
	await page.goto("/#/p7");
	await expect(
		page.getByRole("heading", { level: 1, name: LIBRARY }),
	).toBeVisible();
	await openSidebar(page);
};

// Right-click on a pointer, press-and-hold on touch. They are two ways of
// asking for the same menu and `useContextMenu` unifies them, but only one has
// an echo to swallow -- so driving the desktop gesture on the mobile viewport
// would leave the hold, and the action sheet it opens, uncovered on the surface
// they exist for.
const menuFor = async (page: Page, title: string, isMobile: boolean) => {
	const target = row(page, title);
	if (isMobile) await pressAndHold(page, target);
	else await target.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
};

test.describe("creating a playlist", () => {
	test("the + makes one and drops it straight into rename", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await page.getByRole("button", { name: "New playlist" }).click();

		// Named, waiting to be renamed, and already selected -- one click gets you
		// a playlist and naming it is optional. No toast either: the row is on
		// screen, and a message about something visible is noise.
		const field = page.getByRole("textbox", { name: "Rename New playlist" });
		await expect(field).toBeFocused();
		await expect(field).toHaveValue("New playlist");

		await expect.poll(() => titlesInOrder(player)).toContain("New playlist");

		// The view does not change. A new playlist is somewhere to put things, so
		// throwing you out of the list you were looking at is the wrong reflex.
		await expect(
			page.getByRole("heading", { level: 1, name: LIBRARY }),
		).toBeVisible();
	});

	test("typing a name commits it", async ({ page, player }) => {
		await openApp(page);
		await page.getByRole("button", { name: "New playlist" }).click();

		await page
			.getByRole("textbox", { name: "Rename New playlist" })
			.fill("Road trip");
		await page.keyboard.press("Enter");

		await expect(link(page, "Road trip")).toBeVisible();
		await expect.poll(() => titlesInOrder(player)).toContain("Road trip");
		await expect
			.poll(() => titlesInOrder(player))
			.not.toContain("New playlist");
	});

	test("a second one does not take the same name", async ({ page, player }) => {
		await openApp(page);
		const add = page.getByRole("button", { name: "New playlist" });

		await add.click();
		await expect(
			page.getByRole("textbox", { name: "Rename New playlist" }),
		).toBeFocused();

		// The click blurs the field, which commits the untouched name -- so the
		// second one has to find the collision and count past it.
		await add.click();

		await expect.poll(() => titlesInOrder(player)).toContain("New playlist 2");
	});
});

test.describe("renaming a playlist", () => {
	test("the menu renames it in place", async ({ page, player, isMobile }) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();

		await page
			.getByRole("textbox", { name: `Rename ${FAVORITES}` })
			.fill("Bangers");
		await page.keyboard.press("Enter");

		await expect(link(page, "Bangers")).toBeVisible();
		await expect.poll(() => titlesInOrder(player)).toContain("Bangers");
	});

	test("Escape leaves the name alone", async ({ page, player, isMobile }) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Rename" }).click();

		const field = page.getByRole("textbox", { name: `Rename ${FAVORITES}` });
		await field.fill("Bangers");
		await field.press("Escape");

		// Escape has to beat the blur that follows it. Without that, cancelling
		// commits -- which is the same keystroke doing the opposite of what it says.
		await expect(link(page, FAVORITES)).toBeVisible();
		expect(titlesInOrder(player)).toContain(FAVORITES);
		expect(titlesInOrder(player)).not.toContain("Bangers");
	});
});

test.describe("deleting a playlist", () => {
	test("it confirms on a page of its own, and says what survives", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();

		// A nested page rather than a dialog -- same machinery on both surfaces,
		// and it is the one place the count and the reassurance can be stated.
		await expect(
			page.getByText("7 tracks stay where they are on disk"),
		).toBeVisible();

		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		await expect(link(page, FAVORITES)).toHaveCount(0);
		await expect.poll(() => titlesInOrder(player)).not.toContain(FAVORITES);
	});

	test("backing out of the confirmation keeps it", async ({
		page,
		player,
		isMobile,
	}) => {
		await openApp(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Keep it" }).click();

		await expect(link(page, FAVORITES)).toBeVisible();
		expect(requestsTo(player, "/playlists/remove/")).toHaveLength(0);
	});

	test("deleting what you are looking at steps onto the neighbour", async ({
		page,
		isMobile,
	}) => {
		await openApp(page);
		await link(page, FAVORITES).click();
		await expect(
			page.getByRole("heading", { level: 1, name: FAVORITES }),
		).toBeVisible();

		await openSidebar(page);
		await menuFor(page, FAVORITES, isMobile);
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByRole("menuitem", { name: "Delete playlist" }).click();

		// Somewhere real, rather than the empty view left by the route pointing at
		// a playlist that no longer exists.
		await expect(
			page.getByRole("heading", { level: 1, name: SPANISH }),
		).toBeVisible();
	});
});

test.describe("the drawer", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the sidebar is a drawer only on a phone",
	);

	test("the scrim closes it", async ({ page }) => {
		await openApp(page);
		await expect(link(page, LIBRARY)).toBeVisible();

		// Clicked near the edge rather than at its centre: the scrim covers the
		// whole viewport and sits *under* the drawer, so its middle is behind the
		// thing it dismisses.
		const scrim = page.getByRole("button", { name: "Close menu" });
		const box = await scrim.boundingBox();
		await scrim.click({ position: { x: box!.width - 8, y: box!.height / 2 } });
		await expect(link(page, LIBRARY)).toBeHidden();
	});
});

test.describe("the search entry", () => {
	test("it is not a permanent shelf -- it appears when there is a search", async ({
		page,
	}) => {
		await openApp(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toHaveCount(0);

		await page.getByLabel("Search your library").fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();

		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toBeVisible();

		// The query is the label and the match count is the count, exactly as a
		// playlist row states its own -- because that is what it is standing in for.
		await expect(link(page, "babasonicos")).toContainText("12");
	});

	test("it goes back to the results after browsing away", async ({ page }) => {
		await openApp(page);
		await page.getByLabel("Search your library").fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();

		await openSidebar(page);
		await link(page, SPANISH).click();
		await expect(
			page.getByRole("heading", { level: 1, name: SPANISH }),
		).toBeVisible();

		await openSidebar(page);
		await link(page, "babasonicos").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();
	});
});

// Both of the drags below are mouse-only by design, and the mobile path is the
// menu instead. On a phone there is nothing to drag onto: the sidebar is a
// drawer that covers the list it would be dragged from!.
// Outside the mouse-only block below: opening a playlist has to work on both
// surfaces, and the trap it guards is created by the drag machinery that is
// bound to every row regardless of which pointer will arrive.
test.describe("opening a playlist", () => {
	test("a plain click still opens the playlist", async ({ page }) => {
		await openApp(page);
		await link(page, DEFAULT_PLAYLIST).click();

		// The other side of the same trap. setPointerCapture retargets the
		// compatibility mousedown and mouseup, and click is dispatched at their
		// common ancestor -- so capturing on the row up front makes every click
		// land on the row rather than on the button, and navigation stops working
		// with no error anywhere. The row captures only once it is definitely a
		// drag, which is what keeps this working.
		await expect(
			page.getByRole("heading", { level: 1, name: DEFAULT_PLAYLIST }),
		).toBeVisible();
	});
});

test.describe("reordering playlists", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"drag is mouse-only; touch has the menu",
	);

	test("dragging one over the row below it moves it there", async ({
		page,
		player,
	}) => {
		await openApp(page);

		const from = await row(page, DEFAULT_PLAYLIST).boundingBox();
		const to = await row(page, LIBRARY).boundingBox();

		await page.mouse.move(
			from!.x + from!.width / 2,
			from!.y + from!.height / 2,
		);
		await page.mouse.down();
		// Past the middle of the row below, in steps: the gesture only becomes a
		// drag once it has travelled, and one jump reports a single move event.
		await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height * 0.75, {
			steps: 12,
		});
		await page.mouse.up();

		// Position among the player's playlists, not among the visible rows. The
		// two differ the moment Jean's hidden scratch playlist exists, so the move
		// is asserted on the wire as well as on screen.
		await expect
			.poll(() =>
				requestsTo(player, "/playlists/move/").map((entry) => entry.path),
			)
			.toEqual(["/api/playlists/move/p1/1"]);
		await expect
			.poll(() => titlesInOrder(player).slice(0, 2))
			.toEqual([LIBRARY, DEFAULT_PLAYLIST]);
	});

	test("a drag does not also open the playlist it started on", async ({
		page,
	}) => {
		await openApp(page);

		const from = await row(page, DEFAULT_PLAYLIST).boundingBox();
		const centre = {
			x: from!.x + from!.width / 2,
			y: from!.y + from!.height / 2,
		};

		// Down past the threshold and back again, so the release lands on the row
		// it started on and the browser really does dispatch a click on the button
		// inside it. Ending the drag elsewhere would leave the click at a common
		// ancestor instead, and the test could not fail.
		await page.mouse.move(centre.x, centre.y);
		await page.mouse.down();
		await page.mouse.move(centre.x, centre.y + from!.height * 1.5, {
			steps: 8,
		});
		await page.mouse.move(centre.x, centre.y, { steps: 8 });
		await page.mouse.up();

		// A drag that starts on a link ends with a click on that link, so
		// reordering would navigate as well. Two things stop it independently --
		// the gesture swallows its own click, and pointer capture retargets that
		// click to the row rather than the button inside it -- so removing either
		// one alone leaves this green. It goes red with both gone, which is what
		// makes it a guard on the behaviour rather than on one implementation of
		// it, checked by removing them.
		await expect(
			page.getByRole("heading", { level: 1, name: LIBRARY }),
		).toBeVisible();
	});

	test("Alt with the arrows does the same from the keyboard", async ({
		page,
		player,
	}) => {
		await openApp(page);

		// Registered only while a row holds focus: these are ordinary arrow keys
		// with a modifier and must not fire while the cursor is in the track list.
		await link(page, DEFAULT_PLAYLIST).focus();
		await page.keyboard.press("Alt+ArrowDown");

		await expect
			.poll(() => titlesInOrder(player).slice(0, 2))
			.toEqual([LIBRARY, DEFAULT_PLAYLIST]);
	});
});

test.describe("dragging tracks onto a playlist", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"drag is mouse-only; touch has the menu",
	);

	const dragTrackTo = async (page: Page, index: number, title: string) => {
		const track = trackRow(page, index);
		const target = row(page, title);

		const source = await track.boundingBox();
		const drop = await target.boundingBox();

		await page.mouse.move(
			source!.x + source!.width / 2,
			source!.y + source!.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			drop!.x + drop!.width / 2,
			drop!.y + drop!.height / 2,
			{ steps: 16 },
		);
		return target;
	};

	test("a track dropped on a playlist is copied into it", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const before = player.playlists.find((entry) => entry.title === FAVORITES)!
			.items.length;
		const target = await dragTrackTo(page, 0, FAVORITES);

		// The row arms on an animation frame rather than on the move event, so that
		// a target autoscrolling under a stationary pointer still lights up.
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		// One request whatever the count: indices go up, nothing else does.
		await expect.poll(() => requestsTo(player, "/items/copy").length).toBe(1);
		const copy = requestsTo(player, "/items/copy")[0];
		expect(copy.path).toBe("/api/playlists/p7/p2/items/copy");
		expect(copy.body).toEqual({ items: [0] });

		await expect
			.poll(
				() =>
					player.playlists.find((entry) => entry.title === FAVORITES)!.items
						.length,
			)
			.toBe(before + 1);

		// You are not looking at Favorites, so the copy needs saying -- and that is
		// where the undo lives.
		await expect(page.getByRole("status")).toContainText(FAVORITES);
	});

	test("the playlist you are dragging out of is not a target", async ({
		page,
		player,
	}) => {
		await openApp(page);
		await scrollUntilMounted(page, trackRow(page, 0));

		const target = await dragTrackTo(page, 0, LIBRARY);

		// Dropping a library track back into the library would copy it beside
		// itself, and an autoplaylist would refuse the write anyway.
		await expect(target).not.toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		expect(requestsTo(player, "/items/copy")).toHaveLength(0);
	});
});
