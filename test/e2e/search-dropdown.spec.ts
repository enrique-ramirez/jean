import {
	expect,
	openLibrary,
	openSidebar,
	playedFrom,
	scratchOf,
	searchField,
	searchFor,
	sidebar,
	statusBar,
	test,
	touchDrag,
	trackPlayed,
} from "./fixtures.ts";

// Enough matches that the preview has to leave some out.
const QUERY = "babasonicos";
const OTHER = "nutshell";

// Stated here rather than imported from `PREVIEW_TRACKS`: how many results a preview shows is a
// decision, and a spec that reads it out of the code cannot disagree with a change to it.
const PREVIEW_TRACKS = 8;

const options = (page: Parameters<typeof openLibrary>[0]) =>
	page.getByRole("option");

const hash = (page: Parameters<typeof openLibrary>[0]) =>
	page.evaluate(() => location.hash);

test.describe("previewing a search without leaving the page", () => {
	test("typing draws results over the view rather than replacing it", async ({
		page,
	}) => {
		await openLibrary(page);

		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		// The point of the whole arrangement: a query is a question, not a departure.
		expect(await hash(page)).toBe("#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("emptying the field by hand leaves you exactly where Escape would", async ({
		page,
	}) => {
		await openLibrary(page);

		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		// Backspacing to nothing and pressing Escape must land in the same place,
		// not on an empty search page nobody asked to visit.
		await searchField(page).fill("");
		await expect(options(page)).toHaveCount(0);
		expect(await hash(page)).toBe("#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("Escape closes the preview before it clears the query", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(QUERY);

		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue("");
		expect(await hash(page)).toBe("#/p7");
	});

	test("clicking the field reopens what Escape shut", async ({ page }) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);

		// The caret never left, so focus alone fires nothing -- without a click handler
		// there is no way back to the panel but the keyboard.
		await searchField(page).click();
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);
	});

	test("an arrow reopens what Escape shut", async ({ page }) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);

		await searchField(page).press("ArrowDown");
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);
	});

	test("a space is a character, not a second Enter", async ({ page }) => {
		await openLibrary(page);
		await searchField(page).fill("baba");
		await searchField(page).press("ArrowDown");
		await expect(options(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await searchField(page).press("Space");
		await expect(searchField(page)).toHaveValue("baba ");
		expect(await hash(page)).toBe("#/p7");
	});
});

test.describe("committing to a result", () => {
	test("Enter with nothing under the cursor opens the results and plays nothing", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		await searchField(page).press("Enter");
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
		await expect(options(page)).toHaveCount(0);
		// Opening the results is not choosing one of them.
		expect(playedFrom(player)).toBe(null);
	});

	test("picking a track plays it and leaves you where you were", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		await searchField(page).press("ArrowDown");
		await searchField(page).press("ArrowDown");
		const chosen = await options(page)
			.nth(1)
			.locator("span > span")
			.first()
			.innerText();

		await searchField(page).press("Enter");

		// Through the scratch playlist, the same way the results page plays a row --
		// the set has to exist for one of it to play at all.
		await expect
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		expect(trackPlayed(player)).toBe(chosen);

		expect(await hash(page)).toBe("#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("clicking a track is the same commitment as pressing Enter on it", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		const chosen = await options(page)
			.first()
			.locator("span > span")
			.first()
			.innerText();
		await options(page).first().click();

		await expect(options(page)).toHaveCount(0);
		await expect.poll(() => trackPlayed(player)).toBe(chosen);
		expect(await hash(page)).toBe("#/p7");
	});

	test("playing a track makes the search real, so it can be got back to", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await options(page).first().click();

		// The results had to be materialised for the track to play, so the search is
		// no longer a draft and the sidebar carries it as somewhere to go.
		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toBeVisible();
		await sidebar(page).getByRole("button").filter({ hasText: QUERY }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
	});
});

test.describe("a draft is not the search", () => {
	test("typing over a committed search does not disturb the page behind it", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchFor(page, QUERY);

		await searchField(page).fill(OTHER);
		await expect(options(page).first()).toBeVisible();

		// The whole point: the page answers the last question, not the one being typed.
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
		expect(await hash(page)).toBe("#/search");
		await expect(searchField(page)).toHaveValue(OTHER);
	});

	test("Escape gives the draft back rather than ending the search", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchFor(page, QUERY);
		await searchField(page).fill(OTHER);

		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(OTHER);

		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue(QUERY);

		// However many more times: ending a search is the clear button's job alone.
		await searchField(page).press("Escape");
		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue(QUERY);
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
	});

	test("walking away from a draft discards it", async ({ page, isMobile }) => {
		// Skipped on a phone because the panel covers everything below the top bar:
		// there is nothing to press that is not the panel, which is what the swipe
		// and the clear button are for.
		test.skip(isMobile, "nothing outside the panel to press");

		await openLibrary(page);
		await searchFor(page, QUERY);
		await searchField(page).fill(OTHER);
		await expect(options(page).first()).toBeVisible();

		await page.getByRole("heading", { level: 1, name: QUERY }).click();
		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(QUERY);
	});

	test("clearing is what ends a search, and it ends all of it", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchFor(page, QUERY);

		await page.getByLabel("Clear search").click();
		await expect(searchField(page)).toHaveValue("");
		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Search", { exact: true }),
		).toHaveCount(0);
	});
});

test.describe("on a phone", () => {
	test.skip(({ isMobile }) => !isMobile, "the full-screen panel is the point");

	test("swiping up puts the panel back where it came from", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		const row = await options(page).nth(2).boundingBox();
		expect(row).not.toBeNull();
		const x = (row?.x ?? 0) + (row?.width ?? 0) / 2;
		await touchDrag(
			page,
			{ x, y: (row?.y ?? 0) + 10 },
			{ x, y: (row?.y ?? 0) - 110 },
		);

		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(QUERY);
	});

	test("the preview covers the page under it, status bar included", async ({
		page,
	}) => {
		await openLibrary(page);
		await searchField(page).fill(QUERY);
		await expect(options(page)).toHaveCount(PREVIEW_TRACKS);

		const bar = await statusBar(page).boundingBox();
		expect(bar).not.toBeNull();

		// Asked of the document rather than measured: what matters is that a tap
		// aimed at the transport lands on the panel instead.
		const covered = await page.evaluate(
			([x, y]) => {
				const at = document.elementFromPoint(x, y);
				return at !== null && at.closest("footer") === null;
			},
			[
				(bar?.x ?? 0) + (bar?.width ?? 0) / 2,
				(bar?.y ?? 0) + (bar?.height ?? 0) / 2,
			] as const,
		);

		expect(covered).toBe(true);
	});
});
