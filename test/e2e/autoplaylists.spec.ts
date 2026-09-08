import type { FakePlayer, Page } from "./fixtures.ts";

import {
	expect,
	openSidebar,
	requestsTo,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";

// beefweb's `PlaylistInfo` has six fields and none of them says whether a playlist is an
// autoplaylist. `foo_jean` answers it, and Jean uses the answer only to *remove* affordances -- so
// without the component every playlist looks exactly as it did before.

const PAIRED = { fooJeanToken: "0123456789abcdef0123456789abcdef" };

const createButton = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Create autoplaylist" });

const posts = (player: FakePlayer, path: string) =>
	requestsTo(player, path).filter((entry) => entry.method === "POST");

test.describe("marking autoplaylists in the sidebar", () => {
	test.use({
		...PAIRED,
		fooJean: { autoPlaylists: ["p2"] },
	});

	test("the one the player fills is drawn differently from the rest", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		const rows = sidebar(page).locator("[data-drop-refuses]");
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("Favorites");
	});

	test("it still arms as a drop target, so it can say why not", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		// Excluded with `canDrop` instead, the pointer would sit over a row that reacts
		// to nothing and the reason would arrive only as a toast, after the drop.
		await expect(
			sidebar(page).getByRole("button", { name: /Favorites/ }),
		).toBeVisible();
		await expect(sidebar(page).locator("[data-drop-refuses]")).toHaveAttribute(
			"data-drop-refuses",
			"Autoplaylists fill themselves",
		);
	});
});

test.describe("without the component", () => {
	test("no playlist is marked, and every one still takes a drop", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		await expect(sidebar(page).locator("[data-drop-refuses]")).toHaveCount(0);
	});
});

test.describe("creating one from a genre", () => {
	test.use({ ...PAIRED, fooJean: { maxAutoPlaylists: 100 } });

	test("the player is asked what the query matches before anything is made", async ({
		page,
		player,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await createButton(page).click();

		await expect(page.getByText(/The player matches 13 tracks/)).toBeVisible();
		expect(posts(player, "/autoplaylists/preview").length).toBe(1);
		// Nothing is created by looking -- the only post so far is the preview itself.
		expect(posts(player, "/autoplaylists").length).toBe(1);
	});

	// A wrapped action left at its own width is a short button under a gap the two above it filled.
	test("it fills its row once the header is too narrow to hold three", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the actions only wrap in the compact header");
		await page.setViewportSize({ width: 340, height: 900 });
		await page.goto("/#/genre/Post%20Rock");

		const play = viewHeader(page).getByRole("button", {
			name: "Play",
			exact: true,
		});
		const create = await createButton(page).boundingBox();
		const above = await play.boundingBox();
		const header = await viewHeader(page).boundingBox();

		expect(create?.y).toBeGreaterThan((above?.y ?? 0) + (above?.height ?? 0));
		// The header's own gutter is all that is left either side of it.
		expect(create?.width).toBe((header?.width ?? 0) - 32);
	});

	test("it is named for the genre, with no prefix, and opens once made", async ({
		page,
		player,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await createButton(page).click();

		await expect(page.getByLabel("Playlist name")).toHaveValue("Post Rock");
		await page.getByRole("button", { name: "Create", exact: true }).click();

		// `#Jean` is Jean's own plumbing namespace and is filtered out of the sidebar.
		// A genre autoplaylist is the user's music, so it is named plainly and shows up.
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
		await expect.poll(() => player.playlists.at(-1)?.title).toBe("Post Rock");
	});

	test("the query matches the tag whole, quoted", async ({ page, player }) => {
		await page.goto("/#/genre/Rock%20En%20Espa%C3%B1ol");
		await createButton(page).click();
		await page.getByRole("button", { name: "Create", exact: true }).click();
		await expect
			.poll(() => player.playlists.at(-1)?.title)
			.toBe("Rock En Español");

		const made = posts(player, "/autoplaylists").at(-1);
		// `IS` and not `HAS`: `HAS` is a substring test, so `Rock` would collect
		// `Punk Rock` too -- a different set from the one the tile counted.
		expect(made?.body).toMatchObject({
			title: "Rock En Español",
			query: '%genre% IS "Rock En Español"',
		});
		// No key: a key would make it Jean's to manage, and would 409 the second one.
		expect(made?.body).not.toHaveProperty("key");
	});
});

test.describe("when the player cannot make one", () => {
	test.use({ ...PAIRED, fooJean: { maxAutoPlaylists: 0 } });

	test("the button is absent rather than dead", async ({ page }) => {
		await page.goto("/#/genre/Post%20Rock");
		await expect(
			viewHeader(page).getByRole("button", { name: /Play/ }),
		).toBeVisible();
		await expect(createButton(page)).toHaveCount(0);
	});
});

test.describe("a player with no media library", () => {
	test.use({
		...PAIRED,
		fooJean: { maxAutoPlaylists: 100, libraryEnabled: false },
	});

	test("says so, because every autoplaylist there would be empty", async ({
		page,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await createButton(page).click();

		await expect(page.getByText(/no Media Library configured/)).toBeVisible();
	});
});
