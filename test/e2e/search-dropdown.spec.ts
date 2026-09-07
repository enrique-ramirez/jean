import {
	expect,
	openLibrary,
	openSidebar,
	playedFrom,
	revealSearch,
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
const ARTIST = "Babasónicos";
const ALBUM = "Jessico";
const GENRE = "Grunge";

// Stated here rather than imported: how many results a preview shows is a decision, and a spec that
// reads the number out of the code cannot disagree with a change to it.
const PREVIEW_TRACKS = 8;

const options = (page: Parameters<typeof openLibrary>[0]) =>
	page.getByRole("option");

const tracks = (page: Parameters<typeof openLibrary>[0]) =>
	page.locator('[role="option"][data-kind="track"]');

const ofKind = (page: Parameters<typeof openLibrary>[0], kind: string) =>
	page.locator(`[role="option"][data-kind="${kind}"]`);

const kinds = (page: Parameters<typeof openLibrary>[0]) =>
	options(page).evaluateAll((rows) =>
		rows.map((row) => row.getAttribute("data-kind")),
	);

const hash = (page: Parameters<typeof openLibrary>[0]) =>
	page.evaluate(() => location.hash);

// Every test here is about the field, which the compact header keeps behind an icon.
const openWithSearch = async (page: Parameters<typeof openLibrary>[0]) => {
	await openLibrary(page);
	await revealSearch(page);
};

test.describe("previewing a search without leaving the page", () => {
	test("typing draws results over the view rather than replacing it", async ({
		page,
	}) => {
		await openWithSearch(page);

		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();
		// Whatever else it offers, the tracks it previews are capped.
		await expect(tracks(page)).toHaveCount(PREVIEW_TRACKS);

		// The point of the whole arrangement: a query is a question, not a departure.
		expect(await hash(page)).toBe("#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("emptying the field by hand leaves you exactly where Escape would", async ({
		page,
	}) => {
		await openWithSearch(page);

		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

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
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(QUERY);

		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue("");
		expect(await hash(page)).toBe("#/p7");
	});

	test("clicking the field reopens what Escape shut", async ({ page }) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);

		// The caret never left, so focus alone fires nothing -- without a click handler
		// there is no way back to the panel but the keyboard.
		await searchField(page).click();
		await expect(options(page).first()).toBeVisible();
	});

	test("an arrow reopens what Escape shut", async ({ page }) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);

		await searchField(page).press("ArrowDown");
		await expect(options(page).first()).toBeVisible();
	});

	test("a space is a character, not a second Enter", async ({ page }) => {
		await openWithSearch(page);
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

test.describe("what a query might mean", () => {
	test("an artist the query names gets a section of their own, above the tracks", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);

		await expect(page.getByText("Artists", { exact: false })).toBeVisible();
		// The artist leads, since a query naming one is most likely about them.
		await expect(options(page).first()).toContainText(ARTIST);
		await expect(options(page).first()).toContainText("album");
	});

	test("a query naming exactly one thing starts with the cursor on it", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toContainText(ARTIST);

		// The guess is the highlight rather than something Enter does invisibly.
		await expect(options(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test.describe("a word that names two different things", () => {
		test.use({ retagged: { Bloodhail: { "%title%": ARTIST } } });

		test("is left ambiguous, with nothing under the cursor", async ({
			page,
		}) => {
			await openWithSearch(page);
			// A track is now titled exactly what the artist is called, so neither reading wins
			// and the app declines to guess.
			await searchField(page).fill(QUERY);
			await expect(options(page).first()).toBeVisible();
			await expect(options(page).first()).toHaveAttribute(
				"aria-selected",
				"false",
			);
		});
	});

	test("an album the query names gets a section of its own", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(ALBUM);

		await expect(page.getByText("Albums (1)")).toBeVisible();
		await expect(ofKind(page, "album")).toHaveCount(1);
		// The record's own line answers who it is by and how much of it there is.
		await expect(ofKind(page, "album")).toContainText(ARTIST);
		await expect(ofKind(page, "album")).toContainText("12 tracks");
	});

	test("choosing an album opens the record and leaves the search alone", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchFor(page, OTHER);

		await searchField(page).fill(ALBUM);
		await ofKind(page, "album").click();

		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		// Up out of a record is whoever made it.
		await expect(page.getByRole("link", { name: ARTIST })).toBeVisible();

		// The query was only a way of reaching it, so it never became the search.
		await expect(searchField(page)).toHaveValue(OTHER);
		expect(playedFrom(player)).toBe(null);
	});

	test("a genre the query names is one quiet row, and it says how many there are", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill("rock");

		// Four genres hold `Rock` whole; one row is drawn and the heading is where the
		// other three are.
		await expect(ofKind(page, "genre")).toHaveCount(1);
		await expect(page.getByText("Genre (4)")).toBeVisible();
	});

	test("choosing a genre opens it", async ({ page, player }) => {
		await openWithSearch(page);
		await searchField(page).fill(GENRE);

		await ofKind(page, "genre").click();
		await expect(
			page.getByRole("heading", { level: 1, name: GENRE }),
		).toBeVisible();
		expect(playedFrom(player)).toBe(null);
	});

	test.describe("a query that names one of everything", () => {
		// One track retagged so that the artist, a record and a genre all answer to
		// the same word, which is the only way this small library holds four sections.
		test.use({
			retagged: {
				Nutshell: { "%album%": ARTIST, "%genre%": ARTIST },
			},
		});

		test("draws them artists, albums, genre, then tracks", async ({ page }) => {
			await openWithSearch(page);
			await searchField(page).fill(QUERY);
			await expect(options(page).first()).toBeVisible();

			const drawn = await kinds(page);
			expect(drawn.slice(0, 3)).toEqual(["artist", "album", "genre"]);
			expect(drawn.slice(3).every((kind) => kind === "track")).toBe(true);
		});

		test("leaves the cursor on nothing, since the word has three readings", async ({
			page,
		}) => {
			await openWithSearch(page);
			await searchField(page).fill(QUERY);
			await expect(options(page).first()).toBeVisible();

			// A record named exactly what the artist is called blocks the guess as
			// surely as a track by that name does.
			await expect(options(page).first()).toHaveAttribute(
				"aria-selected",
				"false",
			);
		});
	});

	test("choosing an artist opens their page and leaves the search alone", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchFor(page, OTHER);

		await searchField(page).fill(QUERY);
		await options(page).first().click();

		await expect(
			page.getByRole("heading", { level: 1, name: ARTIST }),
		).toBeVisible();

		// The query was only a way of reaching them, so it never became the search --
		// the field goes back to whatever is still on screen behind, and nothing played.
		await expect(searchField(page)).toHaveValue(OTHER);
		expect(playedFrom(player)).toBe(null);
	});
});

test.describe("committing to a result", () => {
	test("Enter with nothing under the cursor opens the results and plays nothing", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		// Off the artist the query names, so that the cursor really is on nothing.
		await searchField(page).press("Escape");
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
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		// One step down from the artist the query names, which is the first track.
		const chosen = await tracks(page)
			.first()
			.locator("span > span")
			.first()
			.innerText();
		await searchField(page).press("ArrowDown");
		await expect(tracks(page).first()).toHaveAttribute("aria-selected", "true");

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
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		const chosen = await tracks(page)
			.first()
			.locator("span > span")
			.first()
			.innerText();
		await tracks(page).first().click();

		await expect(options(page)).toHaveCount(0);
		await expect.poll(() => trackPlayed(player)).toBe(chosen);
		expect(await hash(page)).toBe("#/p7");
	});

	test("playing a track makes the search real, so it can be got back to", async ({
		page,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await tracks(page).first().click();

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
		await openWithSearch(page);
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
		await openWithSearch(page);
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

		await openWithSearch(page);
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
		await openWithSearch(page);
		await searchFor(page, QUERY);

		await page.getByLabel("Clear search").click();
		// The compact bar puts the field away with the search, so ask for it back before reading it.
		await revealSearch(page);
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
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

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
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

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
