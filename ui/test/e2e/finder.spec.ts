import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { albumRoute } from "../../src/domain/track/routes.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	holdRequests,
	openAllMusic,
	openLibrary,
	playedFrom,
	playRequests,
	routeOf,
	rowByTitle,
	statusBar,
	test,
	times,
	tokenColourIn,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import {
	holdRows,
	positionsNamed,
	rowsAsked,
	titleAtOrdinal,
} from "./libraryLists.ts";

const libraryGuid = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title === "Library")!.guid;

// Counts taken from the captured library. Jessico is twelve Babasónicos tracks
// at the top of the list, Lafcadio eleven further down and entirely off screen.
const ACCENTED = {
	query: "babasonicos",
	matches: 12,
	firstTitle: "Los Calientes",
};
const ONE_HIT = { query: "delectrico", row: 2, title: "Deléctrico" };
const OFF_SCREEN = { query: "lafcadio", matches: 11, firstRow: 30 };

const finder = (page: Page) =>
	page.getByRole("textbox", { name: "Find in this playlist" });

// The status region inside the finder's own field, which is the innermost box holding the input.
const finderCount = (page: Page) =>
	page
		.locator("div")
		.filter({ has: finder(page) })
		.last()
		.getByRole("status");

const results = (page: Page) => page.getByRole("listbox").getByRole("option");
const matchedRows = (page: Page) =>
	page.locator('[role="row"][data-match="true"]');

const openFinder = async (page: Page) => {
	await page.getByRole("button", { name: /Find in this playlist/ }).click();
	await expect(finder(page)).toBeVisible();
};

// Both layouts: the dropdown is the same either way, but what it marks is rows,
// and album mode renders those inside groups.
["compact", "album"].forEach((layout) => {
	test.describe(`the finder in ${layout} layout`, () => {
		test.use({ settings: { "jean.layout": layout } });

		test.describe("opening the finder", () => {
			test.beforeEach(({ page }) => openLibrary(page));

			test("the button opens it with the field already focused", async ({
				page,
			}) => {
				await openFinder(page);

				await expect(finder(page)).toBeFocused();
			});

			test("its border keeps the accent under the pointer, with the caret elsewhere", async ({
				page,
			}) => {
				test.skip(
					test.info().project.name === "mobile",
					"nothing hovers on a phone",
				);

				await openFinder(page);
				const field = finder(page).locator("xpath=..");
				const accent = await tokenColourIn(field, "--accent-line");

				await finder(page).blur();
				await field.hover();

				await expect(field).toHaveCSS("border-top-color", accent);
			});

			test("the first result is the active one, wherever the pointer is", async ({
				page,
			}) => {
				// The results render exactly where the button that opened them was, so
				// the pointer ends up over them without having moved.
				await openFinder(page);
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				await expect(results(page).first()).toHaveAttribute(
					"aria-selected",
					"true",
				);

				// And again for a second query typed under the same still pointer.
				await finder(page).fill(ACCENTED.query);
				await expect(results(page)).toHaveCount(ACCENTED.matches);
				await expect(results(page).first()).toHaveAttribute(
					"aria-selected",
					"true",
				);
			});

			test("hovering a result still selects it, once the pointer really moves", async ({
				page,
			}) => {
				test.skip(
					test.info().project.name === "mobile",
					"nothing hovers on a phone",
				);

				await openFinder(page);
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				const target = results(page).nth(6);
				await target.scrollIntoViewIfNeeded();
				const box = await target.boundingBox();

				// Somewhere else first: the first mouseenter after the finder opens is
				// rejected, there being no earlier position to compare it against, so a
				// single synthetic move onto a result proves nothing either way.
				await page.mouse.move(4, 4);
				await page.mouse.move(
					box!.x + box!.width / 2,
					box!.y + box!.height / 2,
				);

				await expect(target).toHaveAttribute("aria-selected", "true");
			});

			test("arrowing past the fold scrolls the dropdown to follow", async ({
				page,
			}) => {
				test.skip(
					test.info().project.name === "mobile",
					"no keyboard on the phone",
				);

				await openFinder(page);
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				const list = page.getByRole("listbox");

				// The dropdown is 320px over eleven results, so the last of them starts
				// below the fold.
				const last = results(page).nth(OFF_SCREEN.matches - 1);
				for (let at = 1; at < OFF_SCREEN.matches; at += 1)
					await page.keyboard.press("ArrowDown");
				await expect(last).toHaveAttribute("aria-selected", "true");

				// Inside the scroller's own box, not merely inside the page. The last
				// result starts below the fold, so this can only hold if the dropdown
				// followed the active option down.
				const listBox = await list.boundingBox();
				const activeBox = await last.boundingBox();
				expect(activeBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
				expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(
					listBox!.y + listBox!.height + 1,
				);
			});

			test("/ opens it too", async ({ page }) => {
				test.skip(
					test.info().project.name === "mobile",
					"no keyboard on the phone",
				);

				await page.keyboard.press("/");

				await expect(finder(page)).toBeVisible();
				await expect(finder(page)).toBeFocused();
				// The key that opened it is not left in the field.
				await expect(finder(page)).toHaveValue("");
			});
		});

		test.describe("finding", () => {
			test.beforeEach(async ({ page }) => {
				await openLibrary(page);
				await openFinder(page);
			});

			test("finds without filtering the playlist", async ({ page }) => {
				await expect(page.getByRole("grid")).toHaveAttribute(
					"aria-rowcount",
					"54",
				);

				await finder(page).fill(ACCENTED.query);

				await expect(results(page)).toHaveCount(ACCENTED.matches);
				await expect(page.getByRole("grid")).toHaveAttribute(
					"aria-rowcount",
					"54",
				);
				await expect(matchedRows(page).first()).toBeVisible();
			});

			test("says how many it found, where a screen reader hears it", async ({
				page,
			}) => {
				await finder(page).fill(ACCENTED.query);
				await expect(results(page)).toHaveCount(ACCENTED.matches);

				const said = finderCount(page);
				await expect(said).toContainText(`${ACCENTED.matches} matches`);
			});

			test("matches through the accents, not around them", async ({ page }) => {
				// Both sides fold, so both spellings work.
				await finder(page).fill(ACCENTED.query);
				await expect(results(page)).toHaveCount(ACCENTED.matches);
				await expect(results(page).first()).toContainText(ACCENTED.firstTitle);

				await finder(page).fill("Babasónicos");
				await expect(results(page)).toHaveCount(ACCENTED.matches);

				await finder(page).fill(ONE_HIT.query);
				await expect(results(page)).toHaveCount(1);
				await expect(results(page).first()).toContainText(ONE_HIT.title);
			});

			test("every token has to appear, in any order", async ({ page }) => {
				// One word from the title, one from the album: neither field matches the
				// whole query as a substring.
				await finder(page).fill("jessico calientes");
				await expect(results(page)).toHaveCount(1);
				await expect(results(page).first()).toContainText("Los Calientes");

				await finder(page).fill("calientes jessico");
				await expect(results(page)).toHaveCount(1);
			});

			test("says so when nothing matches", async ({ page }) => {
				await finder(page).fill("zzzznothing");

				await expect(results(page)).toHaveCount(0);
				await expect(
					page.getByText("Nothing here matches that."),
				).toBeVisible();
				await expect(matchedRows(page)).toHaveCount(0);
				await expect(page.getByRole("grid")).toHaveAttribute(
					"aria-rowcount",
					"54",
				);
			});
		});

		test.describe("moving through results", () => {
			test.skip(({ isMobile }) => isMobile, "these are keyboard gestures");

			test.beforeEach(async ({ page }) => {
				await openLibrary(page);
				await openFinder(page);
			});

			test("arrowing previews without playing anything", async ({
				page,
				player,
			}) => {
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				await page.keyboard.press("ArrowDown");
				await page.keyboard.press("ArrowDown");
				await expect(results(page).nth(2)).toHaveAttribute(
					"aria-selected",
					"true",
				);

				// The preview is debounced, so give it time to be wrong.
				await expectSettlesAt(player, () => playRequests(player), []);
				await expect(statusBar(page)).toContainText("Nothing playing");

				// It did move the list: the previewed block starts well below the fold
				// and the cursor is now inside it.
				await expect(
					page.locator(`[role="row"][data-cursor="true"]`),
				).toHaveAttribute("data-row", String(OFF_SCREEN.firstRow + 2));
			});

			test("the arrows belong to the finder, not the list behind it", async ({
				page,
			}) => {
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				await page.keyboard.press("ArrowDown");

				// With the playlist's own cursor keys still live, this would move one row
				// down the playlist instead of one result down the finder.
				await expect(results(page).nth(1)).toHaveAttribute(
					"aria-selected",
					"true",
				);
				await expect(
					page.locator('[role="row"][data-cursor="true"]'),
				).toHaveAttribute("data-row", String(OFF_SCREEN.firstRow + 1));
			});

			test("the list stays suspended even after focus leaves the field", async ({
				page,
			}) => {
				// Bindings already ignore keys typed at an input. `keysEnabled` covers
				// the gap after focus leaves the field while the finder is still open:
				// Escape, Enter and the arrows still belong to it.
				const flame = page.getByRole("button", {
					name: "Show play-count heat",
				});
				await finder(page).fill(OFF_SCREEN.query);
				await expect(results(page)).toHaveCount(OFF_SCREEN.matches);

				await page.locator('[role="row"]').first().click();
				await expect(finder(page)).toBeVisible();
				await expect(finder(page)).not.toBeFocused();

				await page.keyboard.press("h");
				await expect(flame).toHaveAttribute("aria-pressed", "true");
			});

			test("letters typed at the field stay in the field", async ({ page }) => {
				// h toggles the play-count shading and v switches the layout: both single
				// keys bound in the list behind this, and both letters of "have".
				const flame = page.getByRole("button", {
					name: "Show play-count heat",
				});
				await expect(flame).toHaveAttribute("aria-pressed", "true");

				await finder(page).fill("have");

				await expect(finder(page)).toHaveValue("have");
				await expect(flame).toHaveAttribute("aria-pressed", "true");
				// Still the compact list, not the album view v would have switched to.
				await expect(page.getByRole("grid")).toHaveAttribute(
					"aria-rowcount",
					"54",
				);
			});
		});

		test.describe("leaving the finder", () => {
			test.beforeEach(async ({ page }) => {
				await openLibrary(page);
				await openFinder(page);
			});

			test("Enter plays the active result and closes", async ({
				page,
				player,
			}) => {
				test.skip(
					test.info().project.name === "mobile",
					"no keyboard on the phone",
				);

				await finder(page).fill(ONE_HIT.query);
				await expect(results(page)).toHaveCount(1);

				await page.keyboard.press("Enter");

				await expect
					.poll(() => playedFrom(player))
					.toEqual({ id: libraryGuid(player), index: ONE_HIT.row });
				await expect(finder(page)).toHaveCount(0);
				await expect(statusBar(page)).toContainText(ONE_HIT.title);
			});

			test("clicking a result plays it", async ({ page, player }) => {
				await finder(page).fill(ONE_HIT.query);
				await expect(results(page)).toHaveCount(1);

				await results(page).first().click();

				await expect
					.poll(() => playedFrom(player))
					.toEqual({ id: libraryGuid(player), index: ONE_HIT.row });
				await expect(statusBar(page)).toContainText(ONE_HIT.title);
			});

			test("Escape closes it without playing", async ({ page, player }) => {
				test.skip(
					test.info().project.name === "mobile",
					"no keyboard on the phone",
				);

				await finder(page).fill(ONE_HIT.query);
				await expect(results(page)).toHaveCount(1);

				await page.keyboard.press("Escape");

				await expect(finder(page)).toHaveCount(0);
				await expectSettlesAt(player, () => playRequests(player), []);
				await expect(statusBar(page)).toContainText("Nothing playing");
			});

			test("closing clears the query and the marks with it", async ({
				page,
			}) => {
				await finder(page).fill(ACCENTED.query);
				await expect(matchedRows(page).first()).toBeVisible();

				await page.getByRole("button", { name: "Close finder" }).click();
				await expect(finder(page)).toHaveCount(0);
				await expect(matchedRows(page)).toHaveCount(0);

				// Reopening starts fresh rather than resuming the closed search.
				await openFinder(page);
				await expect(finder(page)).toHaveValue("");
				await expect(page.getByRole("listbox")).toHaveCount(0);
			});
		});

		test.describe("at library scale", () => {
			test.use({ librarySize: 30441 });

			test("marks every match but renders only a page of them", async ({
				page,
			}) => {
				await openLibrary(page);
				await expect
					.poll(() => page.getByRole("grid").getAttribute("aria-rowcount"), {
						timeout: 30000,
					})
					.toBe("30441");

				await openFinder(page);
				await finder(page).fill("babasonicos");

				// The dropdown is capped at 60 while the playlist keeps marking every
				// hit.
				await expect(results(page)).toHaveCount(60);
				await expect(page.getByRole("grid")).toHaveAttribute(
					"aria-rowcount",
					"30441",
				);
			});
		});
	});
});

test.describe("the field is one field", () => {
	test("the focus ring goes round the field, not round a box inside it", async ({
		page,
	}) => {
		await openLibrary(page);
		await openFinder(page);
		await expect(finder(page)).toBeFocused();

		const rings = await page.evaluate(() => {
			const input = document.querySelector(
				'input[aria-label="Find in this playlist"]',
			) as HTMLElement;
			// Either way of drawing one counts: the shared field draws the ring as a
			// shadow rather than an outline, and the question here is which element
			// wears it rather than which property does.
			const ringOf = (element: Element) => {
				const style = getComputedStyle(element);
				const outline =
					style.outlineStyle === "none"
						? 0
						: Number.parseFloat(style.outlineWidth) || 0;
				return outline > 0 || style.boxShadow !== "none" ? 1 : 0;
			};
			return {
				input: ringOf(input),
				field: ringOf(input.parentElement as HTMLElement),
			};
		});

		// The input is chromeless by construction, and a bare `.input` ties with
		// the global `:focus-visible` rule on specificity and loses on source
		// order, so the ring is easily drawn on the input instead of the field.
		expect(rings.input).toBe(0);
		expect(rings.field).toBe(1);
	});
});

test.describe("typing does not drag the list around", () => {
	test.use({ librarySize: 30441 });

	const scrollTop = (page: Page) =>
		page.locator("main").evaluate((element: HTMLElement) => element.scrollTop);

	test("narrowing a query leaves the view where it is", async ({ page }) => {
		await openLibrary(page);
		await expect
			.poll(() => page.getByRole("grid").getAttribute("aria-rowcount"), {
				timeout: 30000,
			})
			.toBe("30441");

		await openFinder(page);
		const parked = await scrollTop(page);

		// Every keystroke narrows to a different leading match thousands of rows
		// away. Scrolling there remounts the virtualised window and moves the
		// container the sticky finder sits in, and Android's keyboard loses its
		// composition to that -- typed "Guster" comes back scrambled.
		await finder(page).pressSequentially("guster", { delay: 60 });
		await expect(finder(page)).toHaveValue("guster");

		// Asserted across a window rather than at one instant: the view moving and
		// coming back would satisfy a single late read, and a jump that has not
		// happened yet would satisfy an early one.
		await times(6, async () => {
			expect(Math.abs((await scrollTop(page)) - parked)).toBeLessThan(24);
			await page.waitForTimeout(100);
		});
	});
});

test.describe("the field has room to type in", () => {
	test("it takes the space the toolbar has, rather than halving it", async ({
		page,
	}) => {
		await openLibrary(page);
		await openFinder(page);

		const { gap, width } = await page.evaluate(() => {
			const input = document.querySelector(
				'input[aria-label="Find in this playlist"]',
			) as HTMLElement;
			const field = (
				input.parentElement as HTMLElement
			).getBoundingClientRect();
			const flame = document
				.querySelector('button[aria-label="Show play-count heat"]')!
				.getBoundingClientRect();
			return { gap: flame.left - field.right, width: field.width };
		});

		// Which limit binds depends on the viewport: a phone runs out of toolbar, a
		// desktop hits the 400px measure the field caps itself at.
		if (width < 396) {
			expect(gap).toBeLessThan(40);
		} else {
			expect(width).toBeGreaterThanOrEqual(396);
		}
	});
});

test.describe("finding in the library views", () => {
	test.use({ mediaLibrarySize: 4000 });

	const field = (page: Page, name: string) =>
		page.getByRole("textbox", { name });

	test("All music has one, named for what it searches", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await page.getByRole("button", { name: /Find in all music/ }).click();
		await expect(field(page, "Find in all music")).toBeFocused();

		await field(page, "Find in all music").fill("nutshell");
		await expect(
			page.getByRole("listbox").getByRole("option").first(),
		).toBeVisible();

		// Found, not filtered: every row the view had is still there.
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"4000",
		);

		// Asserted after arrowing, because a match in a 4,000-row list is very
		// probably nowhere near the rows currently mounted.
		await page.keyboard.press("ArrowDown");
		await expect(
			page.locator('[role="row"][data-match="true"]').first(),
		).toBeVisible();
	});

	test("a shelf has one too", async ({ page }) => {
		await page.goto("/#/shelf/recent");
		await expect(
			page.getByRole("heading", { level: 1, name: "Recently played" }),
		).toBeVisible();
		await page.getByRole("button", { name: /Find in this shelf/ }).click();
		await expect(field(page, "Find in this shelf")).toBeFocused();
	});

	test("`/` opens it, and typing into it does not reach the player", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await page.locator('[role="row"]').first().click();

		await page.keyboard.press("/");
		await expect(field(page, "Find in all music")).toBeFocused();

		// The list stops answering the keyboard while a field holds it, or typing a
		// track name seeks and pauses the player mid-word.
		await field(page, "Find in all music").fill("nutshell");
		await page.keyboard.press("ArrowRight");
		await expectSettlesAt(
			player,
			() =>
				player.requests.filter(
					(entry) =>
						entry.path.startsWith("/api/playback/") ||
						entry.path === "/api/volume",
				).length,
			0,
		);
	});

	test("`/` takes the caret back after a click on the list", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		// The heading arrives before the list does, and `/` is the list's own
		// binding: pressed at an empty view it reaches nothing and the field never
		// opens. Every other test here clicks a row first, which waits for this.
		await expect(page.locator('[role="row"]').first()).toBeVisible();

		await page.keyboard.press("/");
		await field(page, "Find in all music").fill("nutshell");

		// The finder stays open, so the binding cannot be the one that opens it: it has to answer while the list is standing down for a field that is on screen and no longer has the caret. Aimed at the heading rather than a row, which the results dropdown covers on a phone.
		await page.getByRole("heading", { level: 1, name: "All music" }).click();
		await expect(field(page, "Find in all music")).not.toBeFocused();

		await page.keyboard.press("/");
		await expect(field(page, "Find in all music")).toBeFocused();
		// Selected, not appended to: the second press is a fresh search, as the first was.
		await expect(field(page, "Find in all music")).toHaveValue("nutshell");
		await page.keyboard.type("grace");
		await expect(field(page, "Find in all music")).toHaveValue("grace");
	});

	test("a result plays the track it names", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await page.getByRole("button", { name: /Find in all music/ }).click();
		await field(page, "Find in all music").fill("nutshell");

		const first = page.getByRole("listbox").getByRole("option").first();
		const wanted = await first.innerText();
		await first.click();

		await expect.poll(() => playedFrom(player)).not.toBeNull();
		const at = playedFrom(player)!;
		const playlist = player.playlists.find((entry) => entry.guid === at.id)!;
		expect(wanted).toContain(playlist.items[at.index]["%title%"]);
	});
});

// A window: the rows of one block of this many consecutive positions, fetched in one request.
const WINDOW_ROWS = 2048;

const SEARCHED_ROLES = [
	"title",
	"artist",
	"albumArtist",
	"album",
	"artistSort",
] as const;

const paramsOf = (path: string) =>
	new URL(path, "http://fake.invalid").searchParams;

const searchesAsked = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && routeOf(entry.path) === "/api/library/search",
		)
		.map((entry) => paramsOf(entry.path));

const queriesSearched = (player: FakePlayer) =>
	searchesAsked(player).map((params) => params.get("query"));

const findsAsked = (player: FakePlayer, guid: string) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" &&
				routeOf(entry.path) === `/api/playlists/${guid}/find`,
		)
		.map((entry) => paramsOf(entry.path));

const finderNamed = (page: Page, name: string) =>
	page.getByRole("textbox", { name });

const countIn = (page: Page, name: string) =>
	page
		.locator("div")
		.filter({ has: finderNamed(page, name) })
		.last()
		.getByRole("status");

const openFinderNamed = async (page: Page, name: string) => {
	await page.getByRole("button", { name: new RegExp(name) }).click();
	await expect(finderNamed(page, name)).toBeFocused();
};

const holdQuestions = async (page: Page, hold: boolean) => {
	const answered = await page.request.post("/__control/holdQuestions", {
		data: hold ? { hold: true } : {},
	});
	expect(answered.ok(), "the fake holds questions on request").toBe(true);
};

const playlistOf = (player: FakePlayer, key: string) =>
	player.playlists.find((entry) => entry.id === key)!;

// Digits fold to themselves, and only a title carries any in these libraries, so a number typed
// matches exactly the titles holding it.
const positionsTitled = (titles: readonly unknown[], digits: string) =>
	titles.flatMap((title, position) =>
		String(title).includes(digits) ? [position] : [],
	);

// Every row that ever carried a match while the page was watched, read in the page, since a mark
// drawn from a stale answer lasts only until the next answer replaces it.
const watchMarkedTitles = (page: Page) =>
	page.evaluate(() => {
		const seen = new Set<string>();
		const look = () => {
			for (const row of document.querySelectorAll(
				'[role="row"][data-match="true"]',
			))
				seen.add(row.textContent ?? "");
		};
		look();
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-match"],
		});
		(window as unknown as { __markedRows: () => string[] }).__markedRows =
			() => [...seen];
	});

const markedTitles = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { __markedRows: () => string[] }).__markedRows(),
	);

test.describe("finding in All Music asks foo_jean", () => {
	const ALL_MUSIC = "Find in all music";

	test("each settled draft is one search asking for no tracks and no entities, and nothing else reads the library", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expect(trackRow(page, 0)).toContainText(titleAtOrdinal(player, 0));
		await untilQuiet(player);
		await openFinderNamed(page, ALL_MUSIC);
		const from = player.requests.length;

		await finderNamed(page, ALL_MUSIC).fill(ACCENTED.query);
		await expect(countIn(page, ALL_MUSIC)).toContainText(
			`${ACCENTED.matches} matches`,
		);
		await expectSettlesAt(player, () => queriesSearched(player), [
			ACCENTED.query,
		]);

		await finderNamed(page, ALL_MUSIC).fill(OFF_SCREEN.query);
		await expect(countIn(page, ALL_MUSIC)).toContainText(
			`${OFF_SCREEN.matches} matches`,
		);
		await expectSettlesAt(player, () => queriesSearched(player), [
			ACCENTED.query,
			OFF_SCREEN.query,
		]);

		for (const params of searchesAsked(player)) {
			expect(params.get("limit")).toBe("0");
			expect(params.get("entityLimit")).toBe("0");
		}
		// Every row of the default library is in the one window already held, so a find needs no
		// rows.
		expect(
			player.requests
				.slice(from)
				.filter(
					(entry) =>
						routeOf(entry.path).startsWith("/api/library/") &&
						routeOf(entry.path) !== "/api/library/search",
				)
				.map((entry) => `${entry.method} ${routeOf(entry.path)}`),
		).toEqual([]);
	});

	test("a draft typed while a search is out waits for it, and then is asked", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await openFinderNamed(page, ALL_MUSIC);
		await holdQuestions(page, true);

		await finderNamed(page, ALL_MUSIC).fill(ACCENTED.query);
		await expect
			.poll(() => queriesSearched(player), {
				message: "the finder never asked foo_jean",
			})
			.toEqual([ACCENTED.query]);
		await finderNamed(page, ALL_MUSIC).fill(OFF_SCREEN.query);

		await expectSettlesAt(player, () => queriesSearched(player), [
			ACCENTED.query,
		]);

		await holdQuestions(page, false);
		await expectSettlesAt(player, () => queriesSearched(player), [
			ACCENTED.query,
			OFF_SCREEN.query,
		]);
		await expect(countIn(page, ALL_MUSIC)).toContainText(
			`${OFF_SCREEN.matches} matches`,
		);
	});

	test("an answer counted after tracks were added is dropped, and the find is asked again at the new structure", async ({
		page,
		player,
	}) => {
		// The file the fake adds sorts into Jar Of Flies, the first album, and carries its tags. An
		// answer counted with it marks one row further down than the list held before it: Break
		// Blossom, which opens the next album and never matches.
		const QUERY = "jar";
		const BEFORE = 7;
		const NEVER_MATCHED = "Break Blossom";

		await openAllMusic(page);
		await expect(trackRow(page, 0)).toContainText(titleAtOrdinal(player, 0));
		await openFinderNamed(page, ALL_MUSIC);
		await expect(rowByTitle(page, NEVER_MATCHED)).toBeVisible();
		await watchMarkedTitles(page);
		await untilQuiet(player);

		await holdQuestions(page, true);
		const poll = await holdRequests(
			page,
			(request) => new URL(request.url()).pathname === "/api/state",
		);
		await finderNamed(page, ALL_MUSIC).fill(QUERY);
		await expect
			.poll(() => queriesSearched(player).filter((query) => query === QUERY))
			.toHaveLength(1);

		const added = await page.request.post("/__control/library", {
			data: { add: 1 },
		});
		expect(added.ok(), "the fake adds a file to the library").toBe(true);
		const structureBefore = player.libraryFeed.structure;
		// The rebuild finishes on a state poll. This one is the spec's own and is not held, so the
		// player moves while the page still holds the list it had.
		await expect
			.poll(async () => {
				await page.request.get("/api/state");
				return player.libraryFeed.structure;
			})
			.not.toBe(structureBefore);

		const answered = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/api/library/search" &&
				response.status() === 200,
		);
		await holdQuestions(page, false);
		await answered;
		await untilQuiet(player);

		poll.releaseAll();
		await expect(countIn(page, ALL_MUSIC)).toContainText(
			`${BEFORE + 1} matches`,
		);
		await expect(rowByTitle(page, "Added track 1 (new)")).toHaveAttribute(
			"data-match",
			"true",
		);
		expect(
			queriesSearched(player).filter((query) => query === QUERY).length,
		).toBeGreaterThan(1);
		expect(
			(await markedTitles(page)).filter((title) =>
				title.includes(NEVER_MATCHED),
			),
			"a row was marked from ordinals counted at the other structure",
		).toEqual([]);
	});

	test.describe("past the first window", () => {
		test.use({ mediaLibrarySize: 4000 });
		test.skip(({ isMobile }) => isMobile, "stepping is a keyboard gesture");

		test("a match outside the held windows is asked for by ordinal once the find answers, draws pending until it lands, and is in place when stepped to", async ({
			page,
			player,
		}) => {
			const QUERY = "earthmover";
			const matches = player
				.ordinalOrder()
				.flatMap((entry, ordinal) =>
					String(entry.track["%title%"]).toLowerCase().includes(QUERY)
						? [ordinal]
						: [],
				);
			const target = matches[1];
			expect(
				target,
				"the fixture puts the second match past the first window",
			).toBeGreaterThanOrEqual(WINDOW_ROWS);

			await openAllMusic(page);
			await expect(trackRow(page, 0)).toContainText(titleAtOrdinal(player, 0));
			await openFinderNamed(page, ALL_MUSIC);
			await untilQuiet(player);

			await holdRows(page, true);
			const from = { answered: 0, requests: player.requests.length };
			await finderNamed(page, ALL_MUSIC).fill(QUERY);
			await expect(countIn(page, ALL_MUSIC)).toContainText(
				`${matches.length} matches`,
			);

			const second = results(page).nth(1);
			await expect(second).toHaveAttribute("aria-busy", "true");
			await expect(second).toContainText(`#${target + 1}`);
			await expectSettlesAt(
				player,
				() =>
					rowsAsked(player, from).filter((entry) =>
						positionsNamed(entry.body).includes(target),
					).length,
				1,
			);

			await holdRows(page, false);
			await expect(second).toContainText(titleAtOrdinal(player, target));
			await expect(second).not.toHaveAttribute("aria-busy", "true");

			await page.keyboard.press("ArrowDown");
			await expect(trackRow(page, target)).toContainText(
				titleAtOrdinal(player, target),
			);
			await expect(trackRow(page, target)).toHaveAttribute(
				"data-match",
				"true",
			);
		});
	});
});

test.describe("finding in an album asks foo_jean and marks the album's own", () => {
	// "the" is in five of Deja Entendu's titles and in seven more across the rest of the library.
	const ALBUM = { artist: "Brand New", title: "Deja Entendu" };
	const QUERY = { text: "the", matches: 5 };
	const IN_ALBUM = "Find in this album";

	test("the count and the marks are the album's, asked as a search for no tracks and no entities", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${albumRoute(ALBUM.artist, ALBUM.title)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM.title }),
		).toBeVisible();
		await expect(rowByTitle(page, "Tautou")).toBeVisible();

		await openFinderNamed(page, IN_ALBUM);
		await finderNamed(page, IN_ALBUM).fill(QUERY.text);

		await expect(countIn(page, IN_ALBUM)).toContainText(
			`${QUERY.matches} matches`,
		);
		await expect(results(page)).toHaveCount(QUERY.matches);
		await expect(matchedRows(page)).toHaveCount(QUERY.matches);
		await expect(
			matchedRows(page).filter({ hasText: "Play Crack the Sky" }),
		).toHaveCount(1);
		const asked = searchesAsked(player).filter(
			(params) => params.get("query") === QUERY.text,
		);
		expect(asked).toHaveLength(1);
		expect(asked[0].get("limit")).toBe("0");
		expect(asked[0].get("entityLimit")).toBe("0");
	});
});

test.describe("finding in a playlist asks foo_jean", () => {
	const IN_PLAYLIST = "Find in this playlist";

	test("each settled draft is one find naming the query, the playlist's structure and the searched roles", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await openFinderNamed(page, IN_PLAYLIST);
		const library = playlistOf(player, "p7");

		await finderNamed(page, IN_PLAYLIST).fill(ACCENTED.query);
		await expect(countIn(page, IN_PLAYLIST)).toContainText(
			`${ACCENTED.matches} matches`,
		);
		await expect(results(page).first()).toContainText(ACCENTED.firstTitle);
		await finderNamed(page, IN_PLAYLIST).fill(OFF_SCREEN.query);
		await expect(countIn(page, IN_PLAYLIST)).toContainText(
			`${OFF_SCREEN.matches} matches`,
		);

		await expectSettlesAt(
			player,
			() =>
				findsAsked(player, library.guid).map((params) => params.get("query")),
			[ACCENTED.query, OFF_SCREEN.query],
		);
		for (const params of findsAsked(player, library.guid)) {
			expect(params.get("structure")).toBe(String(library.structure));
			for (const role of SEARCHED_ROLES)
				expect(params.get(role), role).toBe(TRACK_EXPRESSIONS[FIELD[role]]);
		}
	});

	test("a find answered 409 after the playlist was sorted at the player is asked again, and marks the row where it now is", async ({
		page,
		player,
	}) => {
		test.skip(
			test.info().project.name === "mobile",
			"one project is enough for a refusal",
		);
		await openLibrary(page);
		await openFinderNamed(page, IN_PLAYLIST);
		const library = playlistOf(player, "p7");
		const refused: number[] = [];
		page.on("response", (response) => {
			if (
				new URL(response.url()).pathname ===
				`/api/playlists/${library.guid}/find`
			)
				refused.push(response.status());
		});
		const firstFind = await holdRequests(
			page,
			(request) =>
				new URL(request.url()).pathname ===
				`/api/playlists/${library.guid}/find`,
			{ count: 1 },
		);

		await finderNamed(page, IN_PLAYLIST).fill(ONE_HIT.query);
		await firstFind.untilHeld();
		const sortedFrom = String(library.structure);
		expect(player.sortItems("p7", { by: "%title%", desc: true })).toBe(true);
		const movedTo = String(playlistOf(player, "p7").structure);
		const row = playlistOf(player, "p7").items.findIndex(
			(item) => item["%title%"] === ONE_HIT.title,
		);
		expect(row, "the sort moves the track").not.toBe(ONE_HIT.row);

		firstFind.release();

		await expect.poll(() => refused).toContain(409);
		await expect
			.poll(() =>
				findsAsked(player, library.guid).map((params) =>
					params.get("structure"),
				),
			)
			.toContain(movedTo);
		expect(findsAsked(player, library.guid)[0].get("structure")).toBe(
			sortedFrom,
		);
		await expect(countIn(page, IN_PLAYLIST)).toContainText("1 match");
		await page.keyboard.press("ArrowDown");
		await expect(trackRow(page, row)).toHaveAttribute("data-match", "true");
		await expect(trackRow(page, row)).toContainText(ONE_HIT.title);
	});

	test.describe("past the first window", () => {
		test.use({ librarySize: 4000 });
		test.skip(({ isMobile }) => isMobile, "stepping is a keyboard gesture");

		test("the matches outside the held windows are asked for by position once the find answers, draw pending until they land, and the list row lands when stepped to", async ({
			page,
			player,
		}) => {
			const QUERY = "399";
			const library = playlistOf(player, "p7");
			const matches = positionsTitled(
				library.items.map((item) => item["%title%"]),
				QUERY,
			);
			const target = matches[matches.length - 1];
			const title = String(library.items[target]["%title%"]);
			expect(
				target,
				"the fixture puts the last match past the first window",
			).toBeGreaterThanOrEqual(WINDOW_ROWS);
			const itemsOf = (request: { method(): string; url(): string }) =>
				request.method() === "GET" &&
				new URL(request.url()).pathname ===
					`/api/playlists/${library.guid}/items`;

			await openLibrary(page);
			await expect(trackRow(page, 0)).toContainText(
				String(library.items[0]["%title%"]),
			);
			await openFinderNamed(page, IN_PLAYLIST);
			await untilQuiet(player);

			const positioned = await holdRequests(
				page,
				(request) =>
					itemsOf(request) &&
					new URL(request.url()).searchParams.has("positions"),
			);
			await finderNamed(page, IN_PLAYLIST).fill(QUERY);
			await expect(countIn(page, IN_PLAYLIST)).toContainText(
				`${matches.length} matches`,
			);
			const last = results(page).nth(matches.length - 1);
			await expect(last).toHaveAttribute("aria-busy", "true");
			await expect(last).toContainText(`#${target + 1}`);
			await positioned.untilHeld();
			expect(
				positioned.caught.map((request) =>
					new URL(request.url()).searchParams.getAll("positions"),
				),
			).toEqual([
				matches.filter((position) => position >= WINDOW_ROWS).map(String),
			]);

			positioned.releaseAll();
			await expect(last).toContainText(title);
			await expect(last).not.toHaveAttribute("aria-busy", "true");
			await untilQuiet(player);

			const pages = await holdRequests(page, itemsOf);
			await page.keyboard.press("ArrowUp");

			await expect(trackRow(page, target)).toHaveAttribute("aria-busy", "true");
			await expect(trackRow(page, target)).toHaveAttribute(
				"data-match",
				"true",
			);
			await pages.untilHeld();

			pages.releaseAll();
			await expect(trackRow(page, target)).toContainText(
				String(library.items[target]["%title%"]),
			);
			await expect(trackRow(page, target)).not.toHaveAttribute(
				"aria-busy",
				"true",
			);
		});
	});
});
