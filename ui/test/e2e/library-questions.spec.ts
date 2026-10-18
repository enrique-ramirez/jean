import type { Response } from "@playwright/test";
import { LATE_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
} from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import {
	coversFromTheComponent,
	expect,
	expectSettlesAt,
	type FakePlayer,
	fieldOf,
	holdRequests,
	type Page,
	revealSearch,
	routeOf,
	rowByTitle,
	scratchOf,
	searchField,
	test,
	titleOf,
	trackPlayed,
	untilQuiet,
	withNoListOnScreen,
} from "./fixtures.ts";

type QuestionRoute = "album" | "artist" | "genre" | "search";

const questionsTo = (player: FakePlayer, route: QuestionRoute) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" && routeOf(entry.path) === `/api/library/${route}`,
	);

const isQuestionAnswer = (route: QuestionRoute) => (response: Response) =>
	new URL(response.url()).pathname === `/api/library/${route}` &&
	response.status() === 200;

const isLatePart = (response: Response) => {
	const url = new URL(response.url());
	return (
		url.pathname === "/api/library/export" &&
		url.searchParams
			.getAll("only")
			.some((column) => LATE_EXPRESSIONS.includes(column)) &&
		response.ok()
	);
};

const openOnceTheLibraryIsWhole = async (
	page: Page,
	player: FakePlayer,
	route: string,
) => {
	const whole = page.waitForResponse(isLatePart);
	await page.goto("/");
	await whole;
	await untilQuiet(player);
	await page.goto(`/#/${route}`);
};

const FAILURE_PHRASES = [
	en["library.readFailed"],
	en["library.readUnreachable"],
	en["action.tryAgain"],
];

const watchForFailureLines = (page: Page) =>
	page.addInitScript((phrases: string[]) => {
		const said: string[] = [];
		Reflect.set(window, "__failureSaid", said);
		new MutationObserver(() => {
			const text = document.body?.textContent ?? "";
			for (const phrase of phrases)
				if (text.includes(phrase) && !said.includes(phrase)) said.push(phrase);
		}).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, FAILURE_PHRASES);

const failureLinesSaid = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__failureSaid") as string[]);

const watchRowsDrawn = (page: Page) =>
	page.addInitScript(() => {
		const drawn = new Set<string>();
		Reflect.set(window, "__rowsDrawn", drawn);
		new MutationObserver(() => {
			for (const row of document.querySelectorAll('main [role="row"]'))
				drawn.add(row.textContent ?? "");
		}).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	});

const rowsDrawn = (page: Page) =>
	page.evaluate(() => [...(Reflect.get(window, "__rowsDrawn") as Set<string>)]);

const failureLine = (page: Page, phrase: string) =>
	page.getByRole("status").filter({ hasText: phrase });

const tryAgain = (page: Page, phrase: string) =>
	failureLine(page, phrase).getByRole("button", {
		name: en["action.tryAgain"],
	});

const reading = (page: Page) =>
	page.locator("main").getByText(en["library.reading"]);

const rowsListed = (page: Page) => page.locator("main").getByRole("grid");

const expectRowsOf = async (page: Page, count: number) => {
	await expect(rowsListed(page)).toHaveAttribute(
		"aria-rowcount",
		String(count),
	);
	await expect(page.locator('main [role="row"][data-row="0"]')).toBeVisible();
};

const ARTIST = "Babasónicos";
const ALBUM = "Jessico";
const GENRE = "Post Rock";

const tracksOf = (player: FakePlayer, album: string) =>
	player.libraryTracks.filter((track) => fieldOf(track, "%album%") === album);

const tracksInGenre = (player: FakePlayer, genre: string) =>
	player.libraryTracks.filter((track) =>
		fieldOf(track, "%genre%").includes(genre),
	);

// Chromium sends a request again by itself when the keep-alive connection it reused closes with no
// answer, so a connection the fake drops never reaches the page as a failure. Dropped in the browser
// instead, where the page sees it and the fake sees nothing.
const dropInTheBrowser = async (
	page: Page,
	route: QuestionRoute,
	times: number,
) => {
	let asked = 0;
	await page.route(
		(url) => url.pathname === `/api/library/${route}`,
		(intercepted) => {
			asked += 1;
			return asked > times
				? intercepted.fallback()
				: intercepted.abort("connectionreset");
		},
	);
	return () => asked;
};

const failsTwiceThenTriesAgain = async (
	page: Page,
	player: FakePlayer,
	line: string,
	asked: () => number,
) => {
	await openOnceTheLibraryIsWhole(page, player, albumRoute(ARTIST, ALBUM));

	await expect(tryAgain(page, line)).toBeVisible();
	await expect(reading(page)).toBeHidden();
	await expect(page.locator('main [role="row"]')).toHaveCount(0);
	await expectSettlesAt(player, asked, 2);

	await tryAgain(page, line).click();

	await expectRowsOf(page, tracksOf(player, ALBUM).length);
	await expect(failureLine(page, line)).toBeHidden();
	await expectSettlesAt(player, asked, 3);
};

const FAILED_TWICE =
	"draws the failure line with Try again in place of the reading line, asks nothing more by itself, and lists the album after Try again";

test.describe("an album page asking foo_jean", () => {
	test.describe("with its question answered 500 twice", () => {
		test.use({ fooJean: { failQuestions: { status: 500, times: 2 } } });

		test(FAILED_TWICE, async ({ page, player }) => {
			await failsTwiceThenTriesAgain(
				page,
				player,
				en["library.readFailed"],
				() => questionsTo(player, "album").length,
			);
		});
	});

	test.describe("with its connection dropped twice", () => {
		test(FAILED_TWICE, async ({ page, player }) => {
			const asked = await dropInTheBrowser(page, "album", 2);
			await failsTwiceThenTriesAgain(
				page,
				player,
				en["library.readUnreachable"],
				asked,
			);
		});
	});

	test.describe("with its question answered 500 once", () => {
		test.use({ fooJean: { failQuestions: { status: 500, times: 1 } } });

		test("lists the album on the retry and never draws the failure line", async ({
			page,
			player,
		}) => {
			await watchForFailureLines(page);
			await openOnceTheLibraryIsWhole(page, player, albumRoute(ARTIST, ALBUM));

			await expectRowsOf(page, tracksOf(player, ALBUM).length);
			await expectSettlesAt(
				player,
				() => questionsTo(player, "album").length,
				2,
			);
			expect(await failureLinesSaid(page)).toEqual([]);
		});
	});

	test.describe("with its question answered 429 twice", () => {
		test.use({ fooJean: { failQuestions: { status: 429, times: 2 } } });

		test("waits each one out and lists the album, never drawing the failure line", async ({
			page,
			player,
		}) => {
			await watchForFailureLines(page);
			await openOnceTheLibraryIsWhole(page, player, albumRoute(ARTIST, ALBUM));

			await expectRowsOf(page, tracksOf(player, ALBUM).length);
			await expectSettlesAt(
				player,
				() => questionsTo(player, "album").length,
				3,
			);
			expect(await failureLinesSaid(page)).toEqual([]);
		});
	});

	test.describe("with its question held while a track is added to the album", () => {
		test.use({ fooJean: { holdQuestions: true } });

		test("draws nothing from the answer computed at the new structure until Jean holds that structure, then lists the album with the added track", async ({
			page,
			player,
		}) => {
			const first = player.ordinalOrder()[0].track;
			const album = fieldOf(first, "%album%");
			const before = tracksOf(player, album).length;
			const pastTheAlbum = titleOf(player.ordinalOrder()[before].track);
			const known = new Set(
				player.libraryTracks.map((track) => track["%path%"]),
			);

			await watchRowsDrawn(page);
			await openOnceTheLibraryIsWhole(
				page,
				player,
				albumRoute(fieldOf(first, "%album artist%"), album),
			);
			await expect
				.poll(() => questionsTo(player, "album").length, {
					message: "Jean never asked foo_jean for the album",
				})
				.toBeGreaterThan(0);
			await expect(reading(page)).toBeVisible();

			const nextLibrary = await holdRequests(page, (request) =>
				["/api/library/changes", "/api/library/export"].includes(
					new URL(request.url()).pathname,
				),
			);
			const added = await page.request.post("/__control/library", {
				data: { add: 1 },
			});
			expect(added.ok(), "the fake adds a file to the library").toBe(true);
			await nextLibrary.untilHeld();
			const addedTitles = player.libraryTracks
				.filter((track) => !known.has(track["%path%"]))
				.map(titleOf);
			expect(addedTitles).toHaveLength(1);

			const answered = page.waitForResponse(isQuestionAnswer("album"));
			const released = await page.request.post("/__control/holdQuestions", {
				data: {},
			});
			expect(released.ok(), "the fake answers every question it held").toBe(
				true,
			);
			await answered;
			const asked = questionsTo(player, "album").length;
			await expectSettlesAt(
				player,
				() => questionsTo(player, "album").length,
				asked,
			);
			await expect(reading(page)).toBeVisible();

			nextLibrary.releaseAll();

			await expectRowsOf(page, before + 1);
			await expect(rowByTitle(page, addedTitles[0])).toBeVisible();
			expect(questionsTo(player, "album").length).toBeGreaterThan(asked);
			expect(
				(await rowsDrawn(page)).filter((row) => row.includes(pastTheAlbum)),
				"a row was drawn from ordinals counted at the other structure",
			).toEqual([]);
		});
	});

	test.describe("while a play is counted", () => {
		test.use({ countsPlays: true });

		test("lands the play count and asks foo_jean nothing again", async ({
			page,
			player,
		}) => {
			await openOnceTheLibraryIsWhole(page, player, albumRoute(ARTIST, ALBUM));
			await expectRowsOf(page, tracksOf(player, ALBUM).length);
			await expect
				.poll(() => questionsTo(player, "album").length, {
					message: "Jean never asked foo_jean for the album",
				})
				.toBeGreaterThan(0);
			await untilQuiet(player);
			const asked = questionsTo(player, "album").length;

			const ordinal = player
				.ordinalOrder()
				.findIndex((entry) => fieldOf(entry.track, "%album%") === ALBUM);
			const delta = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === "/api/library/changes" &&
					response.status() === 200,
			);
			const played = await page.request.post("/__control/play", {
				data: { ordinal },
			});
			expect(played.ok(), "the fake counts a play by ordinal").toBe(true);
			await delta;

			await expectSettlesAt(
				player,
				() => questionsTo(player, "album").length,
				asked,
			);
		});
	});
});

test.describe("an artist page asking foo_jean", () => {
	test.use({ fooJean: { failQuestions: { status: 500, times: 2 } } });

	test("draws the failure line with Try again after its question fails twice, and lists the artist's records after Try again", async ({
		page,
		player,
	}) => {
		const line = en["library.readFailed"];
		await openOnceTheLibraryIsWhole(page, player, artistRoute(ARTIST));

		await expect(tryAgain(page, line)).toBeVisible();
		await expectSettlesAt(
			player,
			() => questionsTo(player, "artist").length,
			2,
		);

		await tryAgain(page, line).click();

		await expect(
			page.locator("main").getByText(ALBUM, { exact: true }),
		).toBeVisible();
		await expect(failureLine(page, line)).toBeHidden();
	});
});

test.describe("a genre page asking foo_jean", () => {
	test.use({ fooJean: { failQuestions: { status: 500, times: 2 } } });

	test("draws the failure line with Try again after its question fails twice, and lists the genre after Try again", async ({
		page,
		player,
	}) => {
		const line = en["library.readFailed"];
		await openOnceTheLibraryIsWhole(page, player, genreRoute(GENRE));

		await expect(tryAgain(page, line)).toBeVisible();
		await expectSettlesAt(player, () => questionsTo(player, "genre").length, 2);

		await tryAgain(page, line).click();

		await expectRowsOf(page, tracksInGenre(player, GENRE).length);
		await expect(failureLine(page, line)).toBeHidden();
	});
});

interface SearchAnswer {
	matched: unknown;
	matchCount: number;
	best: number[];
	albums: {
		total: number;
		top: { album: string; artist: string; cover: string | null }[];
	};
}

const QUERY = "babasonicos";
const OTHER = "nutshell";
const SONG = "Nutshell";

const queriesSent = (player: FakePlayer) =>
	questionsTo(player, "search").map((entry) =>
		new URL(entry.path, "http://fake.invalid").searchParams.get("query"),
	);

const ANSWER_TIMEOUT_MS = 15_000;

const answerTo = async (page: Page, query: string) => {
	const response = await page.waitForResponse(
		(answer) =>
			isQuestionAnswer("search")(answer) &&
			new URL(answer.url()).searchParams.get("query") === query,
		{ timeout: ANSWER_TIMEOUT_MS },
	);
	return (await response.json()) as SearchAnswer;
};

const searchOnceTheLibraryIsWhole = async (page: Page, player: FakePlayer) => {
	await openOnceTheLibraryIsWhole(page, player, "home");
	await revealSearch(page);
};

const suggestions = (page: Page) =>
	page.getByRole("listbox").getByRole("option");

const trackSuggestions = (page: Page) =>
	page.locator('[role="option"][data-kind="track"]');

const titleAt = (player: FakePlayer, ordinal: number) =>
	titleOf(player.ordinalOrder()[ordinal].track);

const matchCountOf = (count: number) =>
	(count === 1
		? en["search.matchCount"].one
		: en["search.matchCount"].other
	).replace("{count}", String(count));

const countShown = (page: Page) =>
	page.locator("main").getByText(/^\d+ match(es)?$/);

const countOf = (page: Page, count: number) =>
	page.locator("main").getByText(matchCountOf(count), { exact: true });

const failEverySearch = (player: FakePlayer) => {
	player.fooJean.failQuestions = {
		status: 500,
		times: Number.MAX_SAFE_INTEGER,
	};
};

const answerEverySearch = (player: FakePlayer) => {
	player.fooJean.failQuestions = null;
};

test.describe("the search dropdown asking foo_jean", () => {
	test.describe("with nothing held and the search answered 500 twice", () => {
		test.use({ fooJean: { failQuestions: { status: 500, times: 2 } } });

		test("draws the failure line with Try again in place of the no-match line, and the suggestions after Try again", async ({
			page,
			player,
		}) => {
			const line = en["library.readFailed"];
			await searchOnceTheLibraryIsWhole(page, player);
			await searchField(page).fill(QUERY);

			await expect(tryAgain(page, line)).toBeVisible();
			await expect(page.getByText(en["search.noMatch"])).toBeHidden();
			await expect(suggestions(page)).toHaveCount(0);
			await expectSettlesAt(player, () => queriesSent(player).length, 2);

			await tryAgain(page, line).click();

			await expect(suggestions(page).first()).toContainText("Babasónicos");
			await expect(failureLine(page, line)).toBeHidden();
		});
	});

	test("with suggestions held for an earlier draft, draws the failure line above them and outside the list, where the arrows skip it and Tab reaches it", async ({
		page,
		player,
		isMobile,
	}) => {
		const line = en["library.readFailed"];
		await searchOnceTheLibraryIsWhole(page, player);
		await searchField(page).fill(QUERY);
		await expect(suggestions(page).first()).toContainText("Babasónicos");
		const held = await suggestions(page).count();

		failEverySearch(player);
		await searchField(page).fill(OTHER);

		const button = tryAgain(page, line);
		await expect(button).toBeVisible();
		await expect(suggestions(page)).toHaveCount(held);
		await expect(suggestions(page).first()).toContainText("Babasónicos");
		await expect(
			page.getByRole("listbox").getByRole("status"),
			"the failure line is inside the listbox",
		).toHaveCount(0);
		const lineBox = await failureLine(page, line).boundingBox();
		const listBox = await page.getByRole("listbox").boundingBox();
		expect(
			lineBox && listBox && lineBox.y + lineBox.height <= listBox.y + 1,
			"the failure line is not above the held suggestions",
		).toBe(true);

		if (!isMobile) {
			for (let step = 0; step < held; step += 1) {
				await searchField(page).press("ArrowDown");
				await expect(searchField(page)).toBeFocused();
			}
			await expect(suggestions(page).nth(held - 1)).toHaveAttribute(
				"aria-selected",
				"true",
			);

			const TABS_ALLOWED = 3;
			for (
				let step = 0;
				step < TABS_ALLOWED &&
				!(await button.evaluate(
					(element) => element === document.activeElement,
				));
				step += 1
			)
				await page.keyboard.press("Tab");
			await expect(button).toBeFocused();
		}

		answerEverySearch(player);
		await button.click();

		await expect(
			trackSuggestions(page).filter({ hasText: SONG }),
		).toBeVisible();
		await expect(failureLine(page, line)).toBeHidden();
		await expect(
			suggestions(page).filter({ hasText: "Babasónicos" }),
		).toHaveCount(0);
	});

	test.describe("with the search answered 500 once", () => {
		test.use({ fooJean: { failQuestions: { status: 500, times: 1 } } });

		test("draws the suggestions on the retry and never draws the failure line", async ({
			page,
			player,
		}) => {
			await watchForFailureLines(page);
			await searchOnceTheLibraryIsWhole(page, player);
			await searchField(page).fill(QUERY);

			await expect(suggestions(page).first()).toContainText("Babasónicos");
			await expectSettlesAt(player, () => queriesSent(player).length, 2);
			expect(await failureLinesSaid(page)).toEqual([]);
		});
	});

	test("answers a query longer than 1024 bytes with no match, and never sends it", async ({
		page,
		player,
	}) => {
		const tooLong = Array.from({ length: 90 }, () => QUERY).join(" ");
		expect(new TextEncoder().encode(tooLong).length).toBeGreaterThan(1024);

		await searchOnceTheLibraryIsWhole(page, player);
		const answered = answerTo(page, QUERY);
		await searchField(page).fill(QUERY);
		await answered;
		await untilQuiet(player);
		const sent = queriesSent(player).length;

		await searchField(page).fill(tooLong);

		await expect(page.getByText(en["search.noMatch"])).toBeVisible();
		await expectSettlesAt(player, () => queriesSent(player).length, sent);
	});

	test.describe("while each search takes 200 ms", () => {
		test.use({
			fooJean: { routeLatency: { "GET /api/library/search": { ms: 200 } } },
		});

		test("a word typed in one burst sends at most three searches, the last of them the whole word, and the dropdown ends on its answer", async ({
			page,
			player,
		}) => {
			const WORD = "babas";
			await searchOnceTheLibraryIsWhole(page, player);
			const last = answerTo(page, WORD);
			await searchField(page).pressSequentially(WORD);
			const { best } = await last;
			await untilQuiet(player);

			const sent = queriesSent(player);
			expect(sent.length, `sent ${JSON.stringify(sent)}`).toBeLessThanOrEqual(
				3,
			);
			expect(sent.at(-1)).toBe(WORD);
			expect(best.length).toBeGreaterThan(0);
			await expect(trackSuggestions(page)).toHaveCount(best.length);
			for (const [at, ordinal] of best.entries())
				await expect(trackSuggestions(page).nth(at)).toContainText(
					titleAt(player, ordinal),
				);
		});
	});

	test("choosing a track plays it at once from the whole set the search matched", async ({
		page,
		player,
	}) => {
		await searchOnceTheLibraryIsWhole(page, player);
		const answered = answerTo(page, QUERY);
		await searchField(page).fill(QUERY);
		const { best, matchCount } = await answered;
		expect(matchCount).toBeGreaterThan(best.length);

		await trackSuggestions(page).first().click();

		await expect.poll(() => trackPlayed(player)).toBe(titleAt(player, best[0]));
		expect(scratchOf(player)?.items).toHaveLength(matchCount);
	});

	test.describe("with its first file numbered last", () => {
		test.use({ retagged: { "Los Calientes": { "%tracknumber%": "13" } } });

		// A cover is fresh for a week once fetched, so the case opens on the one page that draws none.
		test("an album suggestion draws the cover foo_jean named, and opens the record under the artist it answered", async ({
			page,
			player,
		}) => {
			const whole = page.waitForResponse(isLatePart);
			await withNoListOnScreen(page);
			await whole;
			await untilQuiet(player);
			await revealSearch(page);

			const answered = answerTo(page, "Jessico");
			await searchField(page).fill("Jessico");
			const { albums } = await answered;
			const [album] = albums.top;
			expect(album.cover).not.toBeNull();

			const suggestion = page.locator('[role="option"][data-kind="album"]');
			await expect(suggestion).toHaveCount(1);
			await expect
				.poll(() => coversFromTheComponent(player))
				.toContain(album.cover);

			await suggestion.click();

			await expect
				.poll(() => page.evaluate(() => location.hash))
				.toBe(`#/${albumRoute(album.artist, album.album)}`);
		});
	});
});

test.describe("the search results page asking foo_jean", () => {
	test("with the last results held, draws the failure line with Try again in place of the count and keeps those results listed, then the new answer after Try again", async ({
		page,
		player,
	}) => {
		const line = en["library.readFailed"];
		const first = answerTo(page, QUERY);
		await openOnceTheLibraryIsWhole(page, player, searchRoute(QUERY));
		const held = await first;
		await expect(countOf(page, held.matchCount)).toBeVisible();
		await expectRowsOf(page, held.matchCount);

		failEverySearch(player);
		await page.goto(`/#/${searchRoute(OTHER)}`);

		await expect(tryAgain(page, line)).toBeVisible();
		await expect(countShown(page)).toHaveCount(0);
		await expectRowsOf(page, held.matchCount);

		answerEverySearch(player);
		const next = answerTo(page, OTHER);
		await tryAgain(page, line).click();
		const { matchCount } = await next;

		await expect(countOf(page, matchCount)).toBeVisible();
		await expectRowsOf(page, matchCount);
		await expect(failureLine(page, line)).toBeHidden();
	});
});
