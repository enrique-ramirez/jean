import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import { expect, guidOfPlaylist, test, trackRow } from "./fixtures.ts";

// Every state a library view can be in before, or instead of, a snapshot: the
// component not answering, discovery not back yet, a build under way, and an
// export that failed. Each has to say which one it is. The one thing none of
// them may say is that the library is empty, because the user's library is not.

const ARTIST = "Babasónicos";
const QUERY = "Babas";

const fill = (phrase: string, values: Record<string, string>) =>
	phrase.replace(/\{(\w+)\}/g, (_, name: string) => values[name]);

const patternOf = (phrase: string) =>
	phrase.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+?");

interface LibraryView {
	name: string;
	path: string;
	heading: string | RegExp;
	reading: string | RegExp;
}

const VIEWS: LibraryView[] = [
	{
		name: "All music",
		path: "/#/all",
		heading: en["library.allMusic"],
		reading: en["library.reading"],
	},
	{
		name: "home",
		path: "/",
		// "Your library" until there is a duration to lead with, "… of music" after.
		heading: new RegExp(`${en["home.yourLibrary"]}|${en["home.ofMusic"]}`),
		reading: en["home.reading"],
	},
	{
		name: "the genres index",
		path: "/#/genres",
		heading: en["home.genres"],
		reading: en["library.reading"],
	},
	{
		name: "an artist",
		path: `/#/artist/${encodeURIComponent(ARTIST)}`,
		heading: ARTIST,
		reading: en["library.reading"],
	},
	{
		name: "search results",
		path: `/#/search/${encodeURIComponent(QUERY)}`,
		heading: QUERY,
		// The plain phrase until a total is known, then the count of what it has
		// searched so far.
		reading: new RegExp(
			`${patternOf(en["library.reading"])}|${patternOf(en["search.reading"])}`,
		),
	},
];

const [ALL_MUSIC, HOME, GENRES, AN_ARTIST] = VIEWS;

const main = (page: Page) => page.locator("main");

const headingOf = (page: Page, view: LibraryView) =>
	main(page).getByRole("heading", {
		level: 1,
		name: view.heading,
		exact: typeof view.heading === "string",
	});

const EMPTY_NOTICES = [
	en["library.empty"],
	en["library.noGenre"],
	en["library.noAlbum"],
	en["library.noArtist"],
	en["home.nothingYet"],
	en["genre.noTags"],
	en["artist.nothingBy"],
].map(patternOf);

const READING_COUNT = "Reading .+? of .+? tracks";

// Every match of `patterns` the page has put on screen since it started
// loading. An empty notice drawn for one render and replaced on the next is
// exactly the defect, and a read taken off the screen afterwards cannot see it.
const recordFromLoad = (page: Page, patterns: string[]) =>
	page.addInitScript((sources: string[]) => {
		const drawn: string[] = [];
		Reflect.set(window, "__drawn", drawn);
		const wanted = sources.map((source) => new RegExp(source));
		const look = () => {
			const text = document.body?.textContent ?? "";
			for (const pattern of wanted) {
				const found = text.match(pattern)?.[0];
				if (found && !drawn.includes(found)) drawn.push(found);
			}
		};
		// The document rather than its root element: a browser runs an init
		// script before the parser has made one.
		new MutationObserver(look).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}, patterns);

const drawnSinceLoad = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__drawn") as string[]);

// Discovery never answers until the returned function is called, which is
// *checking* for as long as the test wants it.
const holdCapabilities = async (page: Page) => {
	let answer!: () => void;
	const answered = new Promise<void>((resolve) => {
		answer = resolve;
	});
	await page.route("**/api/capabilities", async (route) => {
		await answered;
		await route.continue();
	});
	return answer;
};

const statePollsSinceExport = (player: FakePlayer) => {
	const at = player.requests.findIndex((entry) =>
		entry.path.startsWith("/api/library/export"),
	);
	if (at < 0) return 0;
	return player.requests
		.slice(at)
		.filter((entry) => entry.path.startsWith("/api/state")).length;
};

// One read, not a retrying one: the notice is already up, so anything of the
// view still on screen now was drawn beside it.
const expectNothingOfTheView = async (page: Page, view: LibraryView) => {
	const text = (await main(page).textContent()) ?? "";
	const counts = {
		heading: await headingOf(page, view).count(),
		rows: await main(page).locator('[role="row"]').count(),
		shelves: await main(page)
			.getByRole("navigation", { name: "Shelves" })
			.count(),
		genres: await main(page)
			.getByRole("link", { name: /tracks?$/ })
			.count(),
		emptyNotices: EMPTY_NOTICES.filter((pattern) =>
			new RegExp(pattern).test(text),
		).length,
	};
	expect(counts).toEqual({
		heading: 0,
		rows: 0,
		shelves: 0,
		genres: 0,
		emptyNotices: 0,
	});
};

const tryAgain = (page: Page) =>
	main(page).getByRole("button", { name: en["action.tryAgain"] });

const checkAgain = (page: Page) =>
	main(page).getByRole("button", { name: en["fooJean.checkAgain"] });

const EXPORT_FAILS = (status: 413 | 500 | 503) => ({
	failLibraryExport: { status, times: 1000 },
});

// The component's own `error` string for each, from the fake, which the notice
// carries through `library.readDetail`.
const withDetail = (message: string, detail: string) =>
	fill(en["library.readDetail"], { message, detail });

const NOTICE_STATES = [
	{
		state: "foo_jean not answering",
		fooJean: { reachable: false },
		promise: "says so, says what to check, and offers to check again",
		expectNotice: async (page: Page) => {
			await expect(
				main(page).getByText(en["fooJean.unreachable.summary"]),
			).toBeVisible();
			await expect(
				main(page).getByText(en["fooJean.unreachable.fix"]),
			).toBeVisible();
			await expect(checkAgain(page)).toBeVisible();
			expect(await tryAgain(page).count()).toBe(0);
		},
	},
	{
		state: "an export refused as too large",
		fooJean: EXPORT_FAILS(413),
		promise: "says so with the component's detail, and offers nothing to press",
		expectNotice: async (page: Page) => {
			await expect(
				main(page).getByText(
					withDetail(
						en["library.readTooLarge"],
						"the library snapshot is larger than this component sends",
					),
				),
			).toBeVisible();
			expect(await tryAgain(page).count()).toBe(0);
		},
	},
	{
		state: "a media library the component is not serving",
		fooJean: EXPORT_FAILS(503),
		promise: "says so with the component's detail, and offers nothing to press",
		expectNotice: async (page: Page) => {
			await expect(
				main(page).getByText(
					withDetail(
						en["library.readUnavailable"],
						"the media library is not available",
					),
				),
			).toBeVisible();
			expect(await tryAgain(page).count()).toBe(0);
		},
	},
	{
		state: "an export that failed at the player",
		fooJean: EXPORT_FAILS(500),
		promise: "says foo_jean could not answer, and offers to try again",
		expectNotice: async (page: Page) => {
			await expect(
				main(page).getByText(en["library.readFailed"], { exact: false }),
			).toBeVisible();
			await expect(tryAgain(page)).toBeVisible();
		},
	},
];

for (const { state, fooJean, promise, expectNotice } of NOTICE_STATES) {
	test.describe(state, () => {
		test.use({ fooJean });

		for (const view of VIEWS) {
			test(`${view.name} ${promise}, in place of its header and content`, async ({
				page,
			}) => {
				await page.goto(view.path);

				await expectNotice(page);
				await expectNothingOfTheView(page, view);
			});
		}
	});
}

test.describe("before discovery answers", () => {
	for (const view of VIEWS) {
		test(`${view.name} draws its header and the reading notice, and never an empty one`, async ({
			page,
		}) => {
			await recordFromLoad(page, EMPTY_NOTICES);
			await holdCapabilities(page);
			await page.goto(view.path);

			await expect(headingOf(page, view)).toBeVisible();
			await expect(main(page).getByText(view.reading)).toBeVisible();
			expect(await drawnSinceLoad(page)).toEqual([]);

			await page.unrouteAll({ behavior: "ignoreErrors" });
		});
	}
});

test.describe("foo_jean not answering, and asked again", () => {
	test.use({ fooJean: { reachable: false } });

	test("Check again asks for the capabilities at once, and the backoff starts over", async ({
		page,
	}) => {
		const asked: number[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === "/api/capabilities")
				asked.push(Date.now());
		});

		await page.goto(ALL_MUSIC.path);
		await expect(checkAgain(page)).toBeVisible();

		// Discovery retries on its own from 500 ms, doubling. Pressed straight
		// after the third ask, the next automatic one is four seconds away, so an
		// ask inside a second can only be the button's.
		await expect.poll(() => asked.length, { intervals: [50] }).toBe(3);
		// Read before the press: the ask can land before `click()` resolves.
		const pressed = Date.now();
		await checkAgain(page).click();

		await expect
			.poll(() => asked.length, { intervals: [50], timeout: 2_000 })
			.toBeGreaterThanOrEqual(4);
		expect(asked[3] - pressed).toBeLessThan(1_000);

		// Without the reset the next automatic ask is eight seconds out; from
		// `MIN_RETRY_MS` it is one.
		await expect
			.poll(() => asked.length, { intervals: [50], timeout: 4_000 })
			.toBeGreaterThanOrEqual(5);
		expect(asked[4] - asked[3]).toBeLessThan(2_500);
	});
});

// The window a freshly started player sits in. Discovery lands, the export
// starts and answers `202`, and the snapshot never comes: every one of those
// steps is a render where the library is not known to be empty.
test.describe("a library still building its first snapshot", () => {
	test.use({ fooJean: { libraryReady: false } });

	for (const view of VIEWS) {
		test(`${view.name} never says the library is empty, from load to the export under way`, async ({
			page,
			player,
		}) => {
			await recordFromLoad(page, EMPTY_NOTICES);
			await page.goto(view.path);

			await expect(headingOf(page, view)).toBeVisible();
			await expect
				.poll(() => statePollsSinceExport(player))
				.toBeGreaterThanOrEqual(3);

			expect(await drawnSinceLoad(page)).toEqual([]);
		});
	}
});

test.describe("a build that reports how far along it is", () => {
	// 54 tracks in slices of 20: the fake walks to 40 formatted and holds there
	// for as long as `libraryBuilds` lasts.
	test.use({ fooJean: { libraryBuilds: 1000, librarySlice: 20 } });

	for (const view of [ALL_MUSIC, HOME, GENRES, AN_ARTIST]) {
		test(`${view.name} counts the tracks read so far`, async ({ page }) => {
			await page.goto(view.path);

			await expect(
				main(page).getByText("Reading 40 of 54 tracks…"),
			).toBeVisible();
		});
	}

	test("All music's progress bar stands at the tracks read out of the total", async ({
		page,
	}) => {
		await page.goto(ALL_MUSIC.path);

		const bar = main(page).getByRole("progressbar");
		await expect(bar).toHaveAttribute("aria-valuenow", "40");
		await expect(bar).toHaveAttribute("aria-valuemax", "54");
	});
});

test.describe("a build counted in the thousands", () => {
	// 40 and 54 read the same raw and formatted. 2,500 in slices of 1,000 holds
	// at 2,000, where a count skipping the app's number formatter shows.
	test.use({
		mediaLibrarySize: 2500,
		fooJean: { libraryBuilds: 1000, librarySlice: 1000 },
	});

	test("All music writes both numbers the way the rest of the app does", async ({
		page,
	}) => {
		await page.goto(ALL_MUSIC.path);

		await expect(
			main(page).getByText("Reading 2,000 of 2,500 tracks…"),
		).toBeVisible();
	});
});

test.describe("a build of one slice", () => {
	// A library that fits one slice goes from nothing formatted to done. The
	// fake still reports `ordering` with the total known, and a count drawn off
	// that would read "0 of 54".
	test.use({ fooJean: { libraryBuilds: 1000 } });

	for (const view of [ALL_MUSIC, HOME]) {
		test(`${view.name} reads the library with no count, ever`, async ({
			page,
			player,
		}) => {
			await recordFromLoad(page, [READING_COUNT]);
			await page.goto(view.path);

			await expect(main(page).getByText(view.reading)).toBeVisible();
			await expect
				.poll(() => statePollsSinceExport(player))
				.toBeGreaterThanOrEqual(3);

			expect(await drawnSinceLoad(page)).toEqual([]);
		});
	}
});

test.describe("an export that fails once", () => {
	test.use({ fooJean: { failLibraryExport: { status: 500, times: 1 } } });

	test("the rows arrive on their own after the failure is shown", async ({
		page,
	}) => {
		await page.goto(ALL_MUSIC.path);
		await expect(
			main(page).getByText(en["library.readFailed"], { exact: false }),
		).toBeVisible();

		await expect(trackRow(page, 0)).toBeAttached();
	});

	test("Try again brings the rows in before the automatic retry could", async ({
		page,
	}) => {
		await page.goto(ALL_MUSIC.path);
		await expect(tryAgain(page)).toBeVisible();

		// The store waits five seconds after a failure before asking on its own,
		// and the button is pressed the moment it shows, so rows inside two
		// seconds of the press are the button's.
		await tryAgain(page).click();
		await expect(trackRow(page, 0)).toBeAttached({ timeout: 2_000 });
	});
});

// One answer per install. A view working out which columns resolve from the
// rows it holds would offer Year on a playlist, whose rows carry one, and
// withhold it on a shelf that has no rows yet.
test.describe("columns before the first snapshot", () => {
	test.use({
		fooJean: { libraryReady: false },
		settings: {
			"jean.fieldAvailability": TRACK_EXPRESSIONS.filter(
				(expression) => expression !== "%year%",
			),
			"jean.columns": ["duration", "rating", "playCount", "year"],
		},
	});

	const offered = async (page: Page) => {
		await page.getByRole("button", { name: en["columns.viewOptions"] }).click();
		const items = page.getByRole("menuitemcheckbox");
		await expect(items.first()).toBeVisible();
		const read = await items.evaluateAll((elements) =>
			elements.map((element) => ({
				name: element.textContent?.trim(),
				checked: element.getAttribute("aria-checked"),
				disabled:
					(element as HTMLButtonElement).disabled ||
					element.getAttribute("aria-disabled") === "true",
			})),
		);
		await page.keyboard.press("Escape");
		return read;
	};

	const YEAR_UNAVAILABLE = fill(en["columns.unavailable"], {
		column: en["column.year"],
	});

	test("a playlist opened first draws no Year, as this browser last heard", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the compact viewport never draws a Year column");

		await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
		// Los Calientes: 4:37 long, on a record from 2001.
		await expect(trackRow(page, 0)).toContainText("4:37");
		expect(await trackRow(page, 0).textContent()).not.toContain("2001");
	});

	test("a playlist opened first and a shelf opened first offer the same columns", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
		await expect(trackRow(page, 0)).toBeAttached();
		const onPlaylist = await offered(page);

		await page.goto("/#/shelf/recent");
		await page.reload();
		await expect(
			page.getByRole("button", { name: en["columns.viewOptions"] }),
		).toBeVisible();
		const onShelf = await offered(page);

		expect(onPlaylist.map((item) => item.name)).toContain(YEAR_UNAVAILABLE);
		expect(onShelf).toEqual(onPlaylist);
	});
});
