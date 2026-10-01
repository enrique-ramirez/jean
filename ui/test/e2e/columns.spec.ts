import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	inSequence,
	openLibrary,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";

// Every optional column is fetched whether or not it is shown, so toggling one
// is a layout change and costs no round trip.

const LEADING = 3; // the number, the artwork, the names cell

const menu = (page: Page) => page.getByRole("button", { name: "View options" });
const option = (page: Page, name: string) =>
	page.getByRole("menuitemcheckbox", { name });

const toggle = async (page: Page, name: string) => {
	await menu(page).click();
	await option(page, name).click();
	await page.keyboard.press("Escape");
	await expect(option(page, name)).toHaveCount(0);
};

// The grid template is built from the same list the cells are rendered from, so
// a template with one track too many leaves an empty column and shifts every
// cell after it. Neither count is interesting alone; only that they agree.
const templateMatchesCells = (page: Page) =>
	trackRow(page, 0).evaluate((row: HTMLElement) => {
		const tracks = getComputedStyle(row)
			.gridTemplateColumns.split(" ")
			.filter(Boolean).length;
		const isGridItem = (child: Element) =>
			getComputedStyle(child).position !== "absolute";
		const cells = [...row.children].filter(isGridItem).length;
		return { tracks, cells };
	});

const cellCount = (page: Page) =>
	templateMatchesCells(page).then(({ cells }) => cells);

const itemFetches = (player: FakePlayer) =>
	requestsTo(player, "/items/").filter((entry) => entry.method === "GET")
		.length;

test.describe("showing and hiding columns", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the compact viewport caps the count; see below",
	);
	test.beforeEach(({ page }) => openLibrary(page));

	test("turning one on adds its cell and asks the player for nothing", async ({
		page,
		player,
	}) => {
		const before = await cellCount(page);
		const fetches = itemFetches(player);

		await toggle(page, "Year");

		await expect.poll(() => cellCount(page)).toBe(before + 1);
		// Jessico is 2001, so the cell that appeared is carrying the year rather
		// than being an empty column that happens to be the right width.
		await expect(trackRow(page, 0)).toContainText("2001");

		await expectSettlesAt(player, () => itemFetches(player), fetches);
	});

	test("turning one off takes the cell with it", async ({ page }) => {
		await expect(trackRow(page, 0)).toContainText("4:37"); // Los Calientes, the duration column
		const before = await cellCount(page);

		await toggle(page, "Time");

		await expect.poll(() => cellCount(page)).toBe(before - 1);
		await expect(trackRow(page, 0)).not.toContainText("4:37");
	});

	test("the grid keeps one track per cell however many are on", async ({
		page,
	}) => {
		expect(await templateMatchesCells(page)).toEqual(
			expect.objectContaining({ tracks: await cellCount(page) }),
		);

		await inSequence(["Year", "Genre", "Codec"], async (name: string) => {
			await toggle(page, name);
			const measured = await templateMatchesCells(page);
			expect(measured.tracks, `after turning on ${name}`).toBe(measured.cells);
		});

		// And with the artwork track removed: album rows sit beside a cover and
		// carry no artwork cell, so a template built for one leaves a hole.
		await toggle(page, "Artwork");
		const bare = await templateMatchesCells(page);
		expect(bare.tracks).toBe(bare.cells);
	});
});

test.describe("the artwork toggle", () => {
	test.beforeEach(({ page }) => openLibrary(page));

	test("it removes the image and the column it sat in", async ({ page }) => {
		await expect(trackRow(page, 0).locator("img")).toHaveCount(1);
		const before = await cellCount(page);

		await toggle(page, "Artwork");

		await expect(trackRow(page, 0).locator("img")).toHaveCount(0);
		await expect.poll(() => cellCount(page)).toBe(before - 1);
	});
});

test.describe("a field the player cannot resolve", () => {
	test.use({ withoutFields: ["%lastfm_play_count%"] });

	test("it is offered as unavailable rather than quietly dropped", async ({
		page,
	}) => {
		await openLibrary(page);
		await menu(page).click();

		const plays = option(page, "Plays (not available)");
		await expect(plays).toBeVisible();
		await expect(plays).toBeDisabled();
	});

	test("it is not counted as a shown column even though it is enabled", async ({
		page,
	}) => {
		await openLibrary(page);

		// 'playCount' is in the stored defaults, so the setting says show it and
		// the player cannot supply it. Rating is the counter-example: nothing
		// carries one here either and it is drawn anyway. See rating.spec.
		const measured = await templateMatchesCells(page);
		expect(measured.tracks).toBe(measured.cells);
		expect(measured.cells).toBe(LEADING + 2); // Time and Rating
	});
});

test.describe("a player that spells play counts the other way", () => {
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
		retagged: {
			"Los Calientes": { "%play_count%": "42" },
			Deléctrico: { "%play_count%": "7" },
		},
	});

	test("the column is offered, because the player can answer it", async ({
		page,
	}) => {
		await openLibrary(page);
		await menu(page).click();

		const plays = option(page, "Plays");
		await expect(plays).toBeVisible();
		await expect(plays).toBeEnabled();
	});

	test("and it shows the count the player actually holds", async ({ page }) => {
		await openLibrary(page);
		await expect(trackRow(page, 0)).toContainText("42");
	});
});

test.describe("on a phone", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the cap only exists on the compact viewport",
	);

	test("it shows at most two columns however many are turned on", async ({
		page,
	}) => {
		await openLibrary(page);

		await menu(page).click();
		await inSequence(
			["Album", "Year", "Genre", "Codec", "Rate", "Last played"],
			(name: string) => option(page, name).click(),
		);
		await page.keyboard.press("Escape");

		// Once the fixed column widths exceed the viewport the flexible names cell
		// collapses to nothing, so the compact layout caps the count rather than
		// trusting the grid. Exactly two: zero optional columns satisfies a cap and
		// is its own bug -- a phone showing no Time at all after six were turned on.
		const measured = await templateMatchesCells(page);
		expect(measured.cells - LEADING).toBe(2);
		expect(measured.tracks).toBe(measured.cells);
	});
});

test.describe("the settings follow you", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"a fourth column is not shown on a phone to begin with",
	);

	test("a reload comes back to the columns you chose", async ({ page }) => {
		await openLibrary(page);

		await toggle(page, "Year");
		await toggle(page, "Artwork");
		await expect(trackRow(page, 0)).toContainText("2001");

		await page.reload();
		await expect(trackRow(page, 0)).toBeAttached();

		await expect(trackRow(page, 0)).toContainText("2001");
		await expect(trackRow(page, 0).locator("img")).toHaveCount(0);

		await menu(page).click();
		await expect(option(page, "Year")).toHaveAttribute("aria-checked", "true");
		await expect(option(page, "Artwork")).toHaveAttribute(
			"aria-checked",
			"false",
		);
	});
});
