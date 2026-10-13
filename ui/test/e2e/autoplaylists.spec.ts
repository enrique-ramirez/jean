import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";

import {
	expect,
	openSidebar,
	requestsTo,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";

// `foo_jean` answers which playlists the player fills itself. This file is about the one use of
// that answer before any write is attempted: the sidebar removes the drop affordance rather than
// offering one the player would refuse. A row it says nothing about is drawn like any other.

// The fixture seeds `Recently Added` as an autoplaylist, so it refuses wherever this file looks.
// `Favorites` refuses only where a describe says the player fills that one too.
const AUTO = "Recently Added";
const FAVORITES = "Favorites";
const ORDINARY = ["Default Playlist", "Library", "Rock en Español"];

// Matched on the label's own text rather than on the row's, because `Library` is inside
// `#Jean Library`. The refusal sits on the row, so the row is what a case addresses.
const row = (page: Page, title: string) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(title, { exact: true }) });

const createButton = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Create autoplaylist" });

const posts = (player: FakePlayer, path: string) =>
	requestsTo(player, path).filter((entry) => entry.method === "POST");

test.describe("marking autoplaylists in the sidebar", () => {
	test.use({
		fooJean: { autoPlaylists: ["p2"] },
	});

	test("the ones the player fills are drawn differently from the rest", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		for (const title of [FAVORITES, AUTO])
			await expect(row(page, title)).toHaveAttribute(
				"data-drop-refuses",
				en["playlist.autoRefuses"],
			);

		// Drawn first, then ordinary: a negated assertion against a row that is not there passes
		// for the wrong reason, and a title this fixture stopped using would read as a pass.
		for (const title of ORDINARY) {
			await expect(row(page, title)).toBeVisible();
			await expect(row(page, title)).not.toHaveAttribute("data-drop-refuses");
		}
	});

	test("one the player fills still arms as a drop target, so it can say why not", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		// Excluded with `canDrop` instead, the pointer would sit over a row that reacts
		// to nothing and the reason would arrive only as a toast, after the drop.
		await expect(
			row(page, FAVORITES).getByRole("button", { name: new RegExp(FAVORITES) }),
		).toBeVisible();
		await expect(row(page, FAVORITES)).toHaveAttribute(
			"data-drop-refuses",
			en["playlist.autoRefuses"],
		);
	});
});

test.describe("a playlist the component says nothing about", () => {
	test("carries no refusal, whatever the row beside it carries", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		// The component is the only source. Nothing here names a playlist for it, so the one the
		// fixture builds at the player is the only row that may refuse, `Favorites` included.
		await expect(row(page, AUTO)).toHaveAttribute(
			"data-drop-refuses",
			en["playlist.autoRefuses"],
		);

		for (const title of [FAVORITES, ...ORDINARY]) {
			await expect(row(page, title)).toBeVisible();
			await expect(row(page, title)).not.toHaveAttribute("data-drop-refuses");
		}
	});
});

test.describe("creating one from a genre", () => {
	test.use({ fooJean: { maxAutoPlaylists: 100 } });

	test("the player is asked what the query matches before anything is made", async ({
		page,
		player,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await createButton(page).click();

		await expect(page.getByText(/The player matches 13 tracks/)).toBeVisible();
		await expect(page.locator("form").getByRole("status")).toContainText(
			"The player matches 13 tracks.",
		);
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

	// The tick is a timer of the page's own, so a stopped clock is a page the next poll never
	// reaches: whatever is drawn after the create came from a read the create asked for itself.
	test("it is open and in the sidebar once made, with no poll tick to wait for", async ({
		page,
	}) => {
		await page.clock.install();
		await page.goto("/#/genre/Post%20Rock");
		await createButton(page).click();
		await expect(page.getByLabel("Playlist name")).toHaveValue("Post Rock");
		await expect(page.getByText(/The player matches 13 tracks/)).toBeVisible();
		await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);

		await page.getByRole("button", { name: "Create", exact: true }).click();

		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
		await expect(
			viewHeader(page).getByRole("button", { name: "Edit autoplaylist" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(row(page, "Post Rock")).toBeVisible();
	});

	test.describe("when the player refuses to make it", () => {
		test.use({ fooJean: { maxAutoPlaylists: 100, failCreate: 409 } });

		test("the refusal to create the autoplaylist is said where a screen reader hears it", async ({
			page,
		}) => {
			await page.goto("/#/genre/Post%20Rock");
			await createButton(page).click();
			await expect(
				page.getByText(/The player matches 13 tracks/),
			).toBeVisible();
			await page.getByRole("button", { name: "Create", exact: true }).click();

			await expect(page.getByRole("alert")).toContainText(
				"Could not create it",
			);
		});
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
			query: 'genre IS "Rock En Español"',
		});
		// No key: a key would make it Jean's to manage, and would 409 the second one.
		expect(made?.body).not.toHaveProperty("key");
	});
});

// The component runs each preview over the whole Media Library on foobar2000's main thread. A
// refused preview once sat on "asking" for as long as the editor stayed open, with Create still
// offered.
test.describe("when the player is asked what a query matches too fast", () => {
	test.use({ fooJean: { maxAutoPlaylists: 100 } });

	const refuse = (page: Page, times: number) =>
		page.request.post("/__control/previewBusy", { data: { times } });

	const create = (page: Page) =>
		page.getByRole("button", { name: "Create", exact: true });

	test("asks again once the player says to, and only then offers Create", async ({
		page,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await refuse(page, 1);
		await createButton(page).click();

		await expect(page.getByText(en["genre.previewBusy"])).toBeVisible();
		await expect(create(page)).toBeDisabled();

		await expect(page.getByText(/The player matches 13 tracks/)).toBeVisible();
		await expect(create(page)).toBeEnabled();
	});

	test("says so and how to ask again when it keeps refusing, and asks again when reopened", async ({
		page,
	}) => {
		await page.goto("/#/genre/Post%20Rock");
		await refuse(page, 100);
		await createButton(page).click();

		await expect(page.getByText(en["genre.previewFailed"])).toBeVisible({
			timeout: 15_000,
		});
		await expect(create(page)).toBeDisabled();

		await refuse(page, 0);
		await page.getByRole("button", { name: "Cancel" }).click();
		await createButton(page).click();

		await expect(page.getByText(/The player matches 13 tracks/)).toBeVisible();
		await expect(create(page)).toBeEnabled();
	});
});

test.describe("when the player cannot make one", () => {
	test.use({ fooJean: { maxAutoPlaylists: 0 } });

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
