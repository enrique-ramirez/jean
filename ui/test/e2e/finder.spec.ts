import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	playedFrom,
	playRequests,
	requestsTo,
	statusBar,
	test,
	times,
} from "./fixtures.ts";

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
				await page.waitForTimeout(300);

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
			() => requestsTo(player, "/player").length,
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
