import { genreRoute } from "../../src/domain/track/routes.ts";
import { GENRE_EXPRESSION } from "../../src/shared/api/multiValue.ts";
import type { Locator, Page } from "./fixtures.ts";
import {
	coversFromTheComponent,
	expect,
	openSidebar,
	requestsTo,
	rowByTitle,
	sidebar,
	test,
	viewHeader,
} from "./fixtures.ts";
import {
	expectPendingRowsPlayByPosition,
	expectTheSetAskedOnce,
	latestAnswer,
	ordinalsOfSet,
	recordLibraryTraffic,
	untilRowsAreHeld,
} from "./libraryLists.ts";
import { openPanels, panelTab, playRow } from "./nowPlaying.ts";
import {
	expectNoRowsLanded,
	expectTheFiguresOf,
	NOTHING_TO_SUM,
	type SetFigures,
} from "./setFigures.ts";

// The fake library carries five genres, one of them accented and two of them two
// words. Enough to tell ranking from filtering.
const finder = (page: Page) =>
	page.getByRole("textbox", { name: "Find a genre" });

const tile = (page: Page, name: string | RegExp) =>
	page.getByRole("link", { name });

const tiles = (page: Page) => page.locator("[data-genre-tile]");

const openGenres = async (page: Page) => {
	await page.goto("/#/genres");
	await expect(tiles(page).first()).toBeVisible();
};

test.describe("the genres index", () => {
	test("it lists every genre in the library, with its figures", async ({
		page,
	}) => {
		await openGenres(page);

		await expect(
			page.getByRole("heading", { level: 1, name: "Genres" }),
		).toBeVisible();
		await expect(tiles(page)).toHaveCount(5);
		await expect(tile(page, /Post Rock/)).toContainText("13 tracks");
	});

	test("the figure on a tile is the number of rows behind it", async ({
		page,
	}) => {
		await openGenres(page);
		await tile(page, /Post Rock/).click();

		// The tile counts through `tagKey` and `refsOfGenre` matches through
		// `tagKey`, and this is the assertion that keeps the two honest.
		await expect(viewHeader(page)).toContainText("13");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
	});

	test.describe("finding one", () => {
		test("an unaccented query finds the accented tag", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("rock en espanol");
			await expect(tiles(page)).toHaveCount(1);
			await expect(tiles(page).first()).toContainText("Rock En Español");
		});

		test("separators are not part of the name", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("postrock");
			await expect(tiles(page).first()).toContainText("Post Rock");
		});

		test("a typo still finds it", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("altenative rock");
			await expect(tiles(page).first()).toContainText("Alternative Rock");
		});

		test("it says so when nothing matches, rather than showing an empty grid", async ({
			page,
		}) => {
			await openGenres(page);
			await finder(page).fill("zzzzqqqq");
			await expect(tiles(page)).toHaveCount(0);
			await expect(page.getByText(/No genre here answers/)).toBeVisible();
		});

		test("`/` puts the caret in the field", async ({ page }) => {
			await openGenres(page);
			await page.keyboard.press("/");
			await expect(finder(page)).toBeFocused();
			// The binding must not also type itself into the field it opened.
			await expect(finder(page)).toHaveValue("");
		});

		test("Enter opens the best match", async ({ page }) => {
			await openGenres(page);
			await finder(page).fill("grun");
			await finder(page).press("Enter");
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				"Grunge",
			);
		});
	});

	test.describe("the keyboard on the grid", () => {
		test("Space opens the focused genre and leaves the music alone", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await tiles(page).first().focus();
			await page.keyboard.press(" ");

			await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
				"Genres",
			);
			// The whole point: Space is the player's play/pause everywhere else, and a
			// tile that opened a genre *and* paused the music is doing two things.
			await expect.poll(() => player.player.playbackState).toBe("playing");
		});

		test("the arrows walk the grid and leave the track where it was", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await tiles(page).first().focus();
			await page.keyboard.press("ArrowRight");
			await expect(tiles(page).nth(1)).toBeFocused();

			await page.keyboard.press("ArrowLeft");
			await expect(tiles(page).first()).toBeFocused();

			// The same trap as Space: left and right seek five seconds everywhere else,
			// and a grid you can walk must not scrub the track under you.
			expect(
				requestsTo(player, "/api/playback/seek").filter(
					(entry) => entry.body?.relativeSeconds !== undefined,
				),
			).toHaveLength(0);
		});

		test("play/pause still works on this page when no tile has the caret", async ({
			page,
			player,
		}) => {
			player.player.playbackState = "playing";
			await openGenres(page);

			await page.locator("main").click({ position: { x: 5, y: 5 } });
			await page.keyboard.press(" ");

			await expect.poll(() => player.player.playbackState).toBe("paused");
		});
	});
});

test.describe("the ways in", () => {
	test("the sidebar carries a Genres row under All music", async ({ page }) => {
		await page.goto("/");
		await openSidebar(page);

		const labels = await sidebar(page).getByRole("button").allInnerTexts();
		const all = labels.findIndex((entry) => entry.startsWith("All music"));
		const genres = labels.findIndex((entry) => entry.startsWith("Genres"));

		expect(genres).toBe(all + 1);
	});

	test("a genre view carries the way back to the index", async ({ page }) => {
		await openGenres(page);
		await tile(page, /Grunge/).click();

		await viewHeader(page)
			.getByRole("link", { name: /All genres/ })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Genres" }),
		).toBeVisible();
	});
});

// A search splits what it is given into words and looks for them in titles too,
// so a genre opened as a search would bring this track along with its own.
test.describe("a genre whose name is also a track's title", () => {
	test.use({ retagged: { Fizz: { "%title%": "Post Rock" } } });

	test("opens the tracks tagged with it, and not the one titled with it", async ({
		page,
	}) => {
		await openGenres(page);
		await expect(tile(page, /Post Rock/)).toContainText("13 tracks");
		await tile(page, /Post Rock/).click();

		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Post Rock",
		);
		await expect(viewHeader(page)).toContainText("13 tracks");
		await expect(page.getByRole("grid")).toBeVisible();
		await expect(rowByTitle(page, "Post Rock")).toHaveCount(0);
	});
});

// Spanish files ñ as a letter of its own, after n, and English as an n with a mark on it. The
// order is the language Jean is showing, which Settings can set apart from the browser's.
test.describe("genres by name, in a language that is not the browser's", () => {
	test.use({
		settings: { "jean.locale": "es", "jean.genreOrder": "name" },
		retagged: {
			"Los Calientes": {
				"%genre%": "Ñu Metal",
				[GENRE_EXPRESSION]: "Ñu Metal",
			},
			Nutshell: { "%genre%": "Nz Funk", [GENRE_EXPRESSION]: "Nz Funk" },
		},
	});

	test("are in that language's order", async ({ page }) => {
		await openGenres(page);

		const names = await tiles(page).allTextContents();
		const at = (name: string) => names.findIndex((text) => text.includes(name));

		expect(at("Nz Funk"), names.join(" | ")).toBeGreaterThanOrEqual(0);
		expect(at("Ñu Metal"), names.join(" | ")).toBeGreaterThan(at("Nz Funk"));
	});
});

test.describe("a track tagged with several genres", () => {
	test.use({
		retagged: {
			"Los Calientes": {
				"%genre%": "Rock En Español, Latin Rock",
				[GENRE_EXPRESSION]: "Rock En Español\u001fLatin Rock",
			},
		},
	});

	test("it counts in each genre, and no tile names two", async ({ page }) => {
		await openGenres(page);

		await expect(tiles(page)).toHaveCount(6);
		await expect(tile(page, /Rock En Español/)).toContainText("12 tracks");
		await expect(tile(page, /Latin Rock/)).toContainText("1 track");
		await expect(tiles(page).filter({ hasText: "," })).toHaveCount(0);

		await tile(page, /Latin Rock/).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Latin Rock",
		);
		await expect(viewHeader(page)).toContainText("1 track");
	});

	test("Details links each genre on its own", async ({ page, isMobile }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Details").click();

		await expect(
			panel.getByRole("link", { name: "Rock En Español", exact: true }),
		).toBeVisible();
		await panel.getByRole("link", { name: "Latin Rock", exact: true }).click();
		await expect(page).toHaveURL(/#\/genre\/Latin%20Rock$/);
	});
});

// More tracks than a header asks for its covers, so the list's own ask cannot be taken for one.
const LISTED_GENRE = "Post Rock";

type GenreAnswer = { refs: Parameters<typeof ordinalsOfSet>[0] };

const openTheGenre = async (page: Page) => {
	const answered = recordLibraryTraffic(page);
	await page.goto(`/#/${genreRoute(LISTED_GENRE)}`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		LISTED_GENRE,
	);
	const refs = ordinalsOfSet(
		(await latestAnswer<GenreAnswer>(answered, "GET /api/library/genre")).refs,
	);
	return { answered, refs };
};

test.describe("a genre's rows", () => {
	test("are asked once, by the ordinals its answer named, and nothing else of the library is read", async ({
		page,
		player,
	}) => {
		const { answered, refs } = await openTheGenre(page);
		const tagged = player
			.ordinalOrder()
			.flatMap((entry, ordinal) =>
				entry.track["%genre%"] === LISTED_GENRE ? [ordinal] : [],
			);
		expect(refs).toEqual(tagged);

		await expectTheSetAskedOnce(answered, player, refs);
		await expect(
			rowByTitle(page, String(player.ordinalOrder()[refs[0]].track["%title%"])),
		).toBeVisible();
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("draw as skeletons and play by their position in the genre", async ({
			page,
			player,
			isMobile,
		}) => {
			const { refs } = await openTheGenre(page);
			await untilRowsAreHeld(player, refs);

			await expectPendingRowsPlayByPosition(page, player, isMobile, refs);
		});
	});
});

// The figures come with the genre's tracks, and with the rows and the whole
// library held there is nothing on the page to count from.
test.describe("a genre's header", () => {
	test.use({ fooJean: NOTHING_TO_SUM });

	test("draws the figures the genre answer carries before any of its rows land", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryTraffic(page);
		await page.goto(`/#/${genreRoute(LISTED_GENRE)}`);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			LISTED_GENRE,
		);
		const { figures } = await latestAnswer<{ figures: SetFigures }>(
			answered,
			"GET /api/library/genre",
		);

		await expectTheFiguresOf(page, figures);
		expectNoRowsLanded(player);
	});
});

interface SummaryGenre {
	name: string;
	count: number;
	albumCount: number;
	artistCount: number;
	covers: string[];
}

// A tile's figure, read whole: "2 albums" must not pass on "12 albums".
const figureText = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

const figureOn = (tile: Locator, text: string) =>
	tile.getByText(text, { exact: true });

const FIGURES: ["count" | "albumCount" | "artistCount", string, string][] = [
	["count", "track", "tracks"],
	["albumCount", "album", "albums"],
	["artistCount", "artist", "artists"],
];

// Guernica is the fifth track of Deja Entendu, so Grunge's tile is two records,
// and the second sleeve is the first Grunge track of Deja Entendu rather than the record's own cover.
test.describe("the genres page, from the summary", () => {
	test.use({
		retagged: {
			Guernica: { "%genre%": "Grunge", [GENRE_EXPRESSION]: "Grunge" },
		},
	});

	const tileNamed = (page: Page, name: string) =>
		tiles(page).filter({ has: page.getByText(name, { exact: true }) });

	test("draws every genre the summary answers when asked for genres, with its tracks, albums and artists and its tile's covers, and reads nothing of the whole library", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryTraffic(page);
		await page.goto("/#/genres");
		await expect(
			page.getByRole("heading", { level: 1, name: "Genres" }),
		).toBeVisible();
		const { genres } = await latestAnswer<{ genres: SummaryGenre[] }>(
			answered,
			"GET /api/library/summary",
			(answer) => answer.params.get("genres") === "true",
		);
		const grunge = genres.find((genre) => genre.name === "Grunge");
		expect(grunge?.covers, "Grunge's tile is one record").toHaveLength(2);
		expect(grunge?.albumCount, "Grunge is not on two records").toBe(2);
		expect(grunge?.artistCount, "Grunge is not by two artists").toBe(2);

		await expect(tiles(page)).toHaveCount(genres.length);
		for (const genre of genres)
			for (const [field, one, many] of FIGURES) {
				const count = genre[field];
				const text = figureText(count, one, many);
				const drawn = figureOn(tileNamed(page, genre.name), text);
				if (count > 0)
					await expect(drawn, `${genre.name}: ${text}`).toBeVisible();
				else await expect(drawn, `${genre.name}: no ${many}`).toHaveCount(0);
			}

		await expect
			.poll(() => {
				const asked = new Set(coversFromTheComponent(player));
				return genres
					.flatMap((genre) => genre.covers)
					.filter((cover) => !asked.has(cover));
			})
			.toEqual([]);
	});
});
