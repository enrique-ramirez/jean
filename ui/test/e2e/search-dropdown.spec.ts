import type { FakePlayer } from "./fixtures.ts";
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
	trackPlayed,
} from "./fixtures.ts";
import { touchDrag } from "./gestures.ts";

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

const libraryHash = (player: FakePlayer) =>
	`#/${player.playlists.find((entry) => entry.title === "Library")!.guid}`;

const openWithSearch = async (page: Parameters<typeof openLibrary>[0]) => {
	await openLibrary(page);
	await revealSearch(page);
};

test.describe("the search field on a phone", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the field is only inset this way at a phone's width",
	);

	test("its glyph sits closer to the edge than a field's does elsewhere", async ({
		page,
	}) => {
		await openWithSearch(page);

		await expect(searchField(page).locator("xpath=..")).toHaveCSS(
			"padding-left",
			"10px",
		);
	});
});

test.describe("previewing a search without leaving the page", () => {
	test("typing draws results over the view rather than replacing it", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);

		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();
		await expect(tracks(page)).toHaveCount(PREVIEW_TRACKS);

		expect(await hash(page)).toBe(libraryHash(player));
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("emptying the field by hand leaves you exactly where Escape would", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);

		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		await searchField(page).fill("");
		await expect(options(page)).toHaveCount(0);
		expect(await hash(page)).toBe(libraryHash(player));
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("Escape closes the preview before it clears the query", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill(QUERY);
		await expect(options(page).first()).toBeVisible();

		await searchField(page).press("Escape");
		await expect(options(page)).toHaveCount(0);
		await expect(searchField(page)).toHaveValue(QUERY);

		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue("");
		expect(await hash(page)).toBe(libraryHash(player));
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

	test("a space is a character, not a second Enter", async ({
		page,
		player,
	}) => {
		await openWithSearch(page);
		await searchField(page).fill("baba");
		await searchField(page).press("ArrowDown");
		await expect(options(page).first()).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await searchField(page).press("Space");
		await expect(searchField(page)).toHaveValue("baba ");
		expect(await hash(page)).toBe(libraryHash(player));
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
		await expect(ofKind(page, "album")).toContainText(ARTIST);
		await expect(ofKind(page, "album")).toContainText("12 tracks");
	});

	test.describe("two records the query names", () => {
		// A second record with the same name by another band, which is what a search has to tell apart
		// by its words: the covers say nothing about which *Jessico* is whose.
		const NAMESAKE = "Alice in Chains";
		test.use({ retagged: { Nutshell: { "%album%": ALBUM } } });

		// A strip of covers needs left and right keys and breaks the one up-and-down axis the panel is
		// walked on, and a cover shelf in a search dropdown is the most streaming-client thing there is.
		test("are rows, one under the other, walked with the arrows and told apart by name", async ({
			page,
		}) => {
			await openWithSearch(page);
			await searchField(page).fill(ALBUM);

			const albums = ofKind(page, "album");
			await expect(albums).toHaveCount(2);
			await expect(albums.filter({ hasText: ARTIST })).toHaveCount(1);
			await expect(albums.filter({ hasText: NAMESAKE })).toHaveCount(1);

			const [first, second] = await albums.evaluateAll((rows) =>
				rows.map((row) => row.getBoundingClientRect().toJSON()),
			);
			const track = await tracks(page).first().boundingBox();
			expect(
				second.top,
				"the second record sits below the first",
			).toBeGreaterThanOrEqual(first.bottom - 1);
			expect(second.left).toBeCloseTo(first.left, 0);
			expect(first.width).toBeCloseTo(track?.width ?? 0, 0);
			expect(second.width).toBeCloseTo(track?.width ?? 0, 0);

			await searchField(page).press("ArrowDown");
			await expect(albums.first()).toHaveAttribute("aria-selected", "true");
			await searchField(page).press("ArrowDown");
			await expect(albums.nth(1)).toHaveAttribute("aria-selected", "true");
		});
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
		await expect(page.getByRole("link", { name: ARTIST })).toBeVisible();

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

		await searchField(page).press("Escape");
		await searchField(page).press("Enter");
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
		await expect(options(page)).toHaveCount(0);
		expect(playedFrom(player)).toBe(null);
	});

	test("picking a track plays it and leaves you where you were", async ({
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
		await searchField(page).press("ArrowDown");
		await expect(tracks(page).first()).toHaveAttribute("aria-selected", "true");

		await searchField(page).press("Enter");

		// Through the scratch playlist, the same way the results page plays a row --
		// the set has to exist for one of it to play at all.
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		expect(trackPlayed(player)).toBe(chosen);

		expect(await hash(page)).toBe(libraryHash(player));
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
		expect(await hash(page)).toBe(libraryHash(player));
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

		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
		expect(await hash(page)).toBe(`#/search/${encodeURIComponent(QUERY)}`);
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

		await searchField(page).press("Escape");
		await searchField(page).press("Escape");
		await expect(searchField(page)).toHaveValue(QUERY);
		await expect(
			page.getByRole("heading", { level: 1, name: QUERY }),
		).toBeVisible();
	});

	test("walking away from a draft discards it", async ({ page, isMobile }) => {
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
