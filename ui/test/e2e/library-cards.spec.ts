import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
	shelfRoute,
} from "../../src/domain/track/routes.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	fieldOf,
	guidOfPlaylist,
	holdRequests,
	searchFor,
	test,
	titleOf,
	titlesIn,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import { openRowMenu } from "./menus.ts";

// Every expected figure is counted here from the fake's own tracks, so a figure the cards draw is
// checked against the fixture rather than against a number copied out of a screenshot.

type Track = Record<string, string>;

type CardName = "played" | "plays" | "most-played" | "genres";

const CARD_NAMES: CardName[] = ["played", "plays", "most-played", "genres"];

const cards = (page: Page) => page.locator("[data-library-cards]");

const card = (page: Page, name: CardName) =>
	cards(page).locator(`[data-card="${name}"]`);

const genreLinks = (page: Page) => card(page, "genres").getByRole("link");

const toolbar = (page: Page) =>
	page.getByRole("group", { name: "Track layout" });

const tracksFigure = (page: Page) =>
	viewHeader(page).locator('p[data-figures] span[data-figure="tracks"]');

const DATE_PARTS = {
	year: "numeric",
	month: "long",
	day: "numeric",
} as const;

const IS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}/;

const playsOf = (track: Track) => {
	const count = Number(fieldOf(track, "%lastfm_play_count%"));
	return Number.isFinite(count) ? count : 0;
};

const lastPlayedOf = (track: Track) => {
	const raw = fieldOf(track, "%lastfm_last_played%");
	return IS_TIMESTAMP.test(raw) ? raw : null;
};

const figuresOf = (tracks: Track[]) => {
	const total = tracks.length;
	const unplayed = tracks.filter((track) => playsOf(track) === 0).length;
	const plays = tracks.reduce((sum, track) => sum + playsOf(track), 0);
	const most = tracks.reduce<Track | null>(
		(best, track) =>
			playsOf(track) > (best ? playsOf(best) : 0) ? track : best,
		null,
	);
	const lastPlayed =
		tracks
			.map(lastPlayedOf)
			.filter((raw): raw is string => raw !== null)
			.sort()
			.at(-1) ?? null;
	const counts = new Map<string, number>();
	for (const track of tracks) {
		const genre = fieldOf(track, "%genre%");
		counts.set(genre, (counts.get(genre) ?? 0) + 1);
	}
	const genres = [...counts]
		.map(([name, count]) => ({
			name,
			count,
			share: Math.round((count / total) * 100),
		}))
		.sort((a, b) => b.count - a.count);
	return {
		total,
		played: total - unplayed,
		unplayed,
		share: (total - unplayed) / total,
		plays,
		lastPlayed,
		mostPlayed: most ? { title: titleOf(most), plays: playsOf(most) } : null,
		genres,
	};
};

const tracksIn = (player: FakePlayer, key: string) =>
	player.playlists.find((entry) => entry.id === key)!.items;

const byArtist = (player: FakePlayer, artist: string) =>
	player.libraryTracks.filter((track) => fieldOf(track, "%artist%") === artist);

const byAlbum = (player: FakePlayer, album: string) =>
	player.libraryTracks.filter((track) => fieldOf(track, "%album%") === album);

// Formatted by the page's own `Intl`, in the page's own time zone, which is what `useFormats` reads a
// foobar2000 timestamp in.
const numberIn = (page: Page, value: number, locale: string) =>
	page.evaluate(
		([value, locale]) => new Intl.NumberFormat(locale).format(value),
		[value, locale] as const,
	);

const dateIn = (page: Page, raw: string, locale: string) =>
	page.evaluate(
		([raw, locale, parts]) =>
			new Intl.DateTimeFormat(locale, parts).format(
				Date.parse(raw.replace(" ", "T")),
			),
		[raw, locale, DATE_PARTS] as const,
	);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A figure read as the reader reads it, line by line, and never as part of a longer number: "1 never
// played" must not pass on "11 never played", nor "0 of 11" on "10 of 11".
const expectFigure = (scope: Locator, text: string) =>
	expect(scope).toContainText(
		new RegExp(`(^|[^\\d.,])${escaped(text)}($|[^\\d.,])`),
		{ useInnerText: true },
	);

const genreLinkNamed = (page: Page, name: string, share: number) =>
	genreLinks(page).filter({
		hasText: new RegExp(`^${escaped(name)}\\s*${share}%$`),
	});

const openArtist = async (page: Page, name: string) => {
	await page.goto(`/#/${artistRoute(name)}`);
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

interface View {
	name: string;
	path: (player: FakePlayer) => string;
	title: string;
}

const LIBRARY_PLAYLIST: View = {
	name: "a playlist",
	path: (player) => guidOfPlaylist(player, "p7"),
	title: "Library",
};

const ALL_MUSIC: View = {
	name: "All music",
	path: () => "all",
	title: "All music",
};

const A_GENRE: View = {
	name: "a genre",
	path: () => genreRoute("Rock En Español"),
	title: "Rock En Español",
};

const LIST_VIEWS: View[] = [
	{
		name: "an album",
		path: () => albumRoute("Brand New", "Deja Entendu"),
		title: "Deja Entendu",
	},
	A_GENRE,
	{ name: "a shelf", path: () => shelfRoute("top"), title: "Most played" },
	LIBRARY_PLAYLIST,
	ALL_MUSIC,
	{
		name: "search results",
		path: () => searchRoute("babasonicos"),
		title: "babasonicos",
	},
	{
		name: "the artist's Tracks tab",
		path: () => artistRoute("Babasónicos", "tracks"),
		title: "Babasónicos",
	},
];

const openView = async (page: Page, player: FakePlayer, view: View) => {
	await page.goto(`/#/${view.path(player)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: view.title }),
	).toBeVisible();
};

const countedWithPlays = (page: Page) =>
	expect(card(page, "played")).toContainText("%");

const counted = (page: Page) => expect(tracksFigure(page)).toBeVisible();

test.describe("on the artist page's Overview", () => {
	test("In your library is the first section under the header, ahead of About and Discography", async ({
		page,
	}) => {
		await openArtist(page, "Babasónicos");
		await expect(
			page.getByRole("heading", { level: 2, name: "Discography" }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "In your library" }),
		).toBeVisible();
		await expect(cards(page)).toHaveCount(1);

		const sections = await page.evaluate(() =>
			[...document.querySelectorAll("main section")]
				.filter((section) => !section.closest("header"))
				.map((section) => ({
					isCards: section.hasAttribute("data-library-cards"),
					heading: section.querySelector("h2")?.textContent?.trim() ?? "",
				})),
		);
		expect(sections[0]).toEqual({ isCards: true, heading: "In your library" });
		const at = (heading: string) =>
			sections.findIndex((section) => section.heading === heading);
		expect(at("About")).toBeGreaterThan(0);
		expect(at("Discography")).toBeGreaterThan(0);
	});
});

test.describe("the cards on a playlist", () => {
	test("Played gives the share played as a percentage, how many of how many, the never-played count and a meter", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		await openView(page, player, LIBRARY_PLAYLIST);
		await countedWithPlays(page);

		const played = card(page, "played");
		await expect(played.getByText("Played", { exact: true })).toBeVisible();
		await expectFigure(played, `${Math.round(set.share * 100)}%`);
		await expectFigure(played, `${set.played} of ${set.total}`);
		await expectFigure(played, `${set.unplayed} never played`);

		// A share the fixture does not round to: 39 of 54 is 0.722, so a meter filled to the rounded
		// percentage, to the never-played share or to the whole width is a different scale.
		await expect
			.poll(() =>
				played.evaluate(
					(root, share) =>
						[...root.querySelectorAll("*")].some((element) => {
							const transform = getComputedStyle(element).transform;
							if (transform === "none") return false;
							return Math.abs(new DOMMatrix(transform).a - share) < 0.005;
						}),
					set.share,
				),
			)
			.toBe(true);
	});

	test("Plays gives the total and the date last listened", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		await openView(page, player, LIBRARY_PLAYLIST);
		await countedWithPlays(page);

		const plays = card(page, "plays");
		await expect(plays.getByText("Plays", { exact: true })).toBeVisible();
		await expectFigure(plays, await numberIn(page, set.plays, "en"));
		await expect(plays).toContainText(
			`Last listened ${await dateIn(page, set.lastPlayed!, "en")}`,
		);
	});

	test("Most played names the track played most and how many times", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		await openView(page, player, LIBRARY_PLAYLIST);
		await countedWithPlays(page);

		const most = card(page, "most-played");
		await expect(most.getByText("Most played", { exact: true })).toBeVisible();
		await expect(most).toContainText(set.mostPlayed!.title);
		await expectFigure(most, `${set.mostPlayed!.plays} plays`);
	});

	test("Genres links the four biggest genres to their pages, each with its share", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		await openView(page, player, LIBRARY_PLAYLIST);
		await expect(genreLinks(page).first()).toBeVisible();

		await expect(
			card(page, "genres").getByText("Genres", { exact: true }),
		).toBeVisible();
		await expect(genreLinks(page)).toHaveCount(4);
		for (const genre of set.genres.slice(0, 4))
			await expect(
				genreLinkNamed(page, genre.name, genre.share),
				`${genre.name} at ${genre.share}%`,
			).toHaveAttribute("href", `#/${genreRoute(genre.name)}`);
		// The fifth genre, which a card drawing every genre would carry.
		await expect(
			genreLinks(page).filter({ hasText: set.genres[4].name }),
		).toHaveCount(0);
	});
});

test.describe("an album nobody has played", () => {
	test("draws no Most played, and Played says none of them", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byAlbum(player, "Lafcadio"));
		expect(set.mostPlayed, "the fixture's album is never played").toBeNull();
		await page.goto(`/#/${albumRoute("As Tall as Lions", "Lafcadio")}`);
		await countedWithPlays(page);

		await expectFigure(card(page, "played"), `0 of ${set.total}`);
		await expect(card(page, "most-played")).toHaveCount(0);
	});
});

test.describe("an install with play counts and no last-played dates", () => {
	test.use({ withoutFields: ["%lastfm_last_played%"] });

	test("Plays gives the total and says nothing about when", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		await openView(page, player, LIBRARY_PLAYLIST);
		await countedWithPlays(page);

		const plays = card(page, "plays");
		await expectFigure(plays, await numberIn(page, set.plays, "en"));
		await expect(plays).not.toContainText("Last listened");
	});
});

test.describe("an install with no play counts", () => {
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
	});

	test("draws Genres alone, with no Played, Plays or Most played", async ({
		page,
		player,
	}) => {
		await openView(page, player, LIBRARY_PLAYLIST);
		await expect(genreLinks(page).first()).toBeVisible();
		await counted(page);

		await expect(card(page, "played")).toHaveCount(0);
		await expect(card(page, "plays")).toHaveCount(0);
		await expect(card(page, "most-played")).toHaveCount(0);
		await expect(card(page, "genres")).toBeVisible();
	});
});

test.describe("an install with no play counts and no genre tags", () => {
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%", "%genre%"],
	});

	for (const view of [LIBRARY_PLAYLIST, ALL_MUSIC])
		test(`${view.name} draws no In your library section at all`, async ({
			page,
			player,
		}) => {
			await openView(page, player, view);
			await counted(page);

			await expect(cards(page)).toHaveCount(0);
			await expect(
				page.getByRole("heading", { name: "In your library" }),
			).toHaveCount(0);
		});

	test("the artist's Overview draws no In your library section at all", async ({
		page,
	}) => {
		await openArtist(page, "Babasónicos");
		await expect(
			page.getByRole("heading", { level: 2, name: "Discography" }),
		).toBeVisible();
		await counted(page);

		await expect(cards(page)).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "In your library" }),
		).toHaveCount(0);
	});
});

// With play counts declared and no track in the set, Played and Plays have nothing to say: "0% / 0 of 0
// / 0 never played / Plays 0" is a row of cards about nothing. Read once the page has said the set is
// empty and the player has stopped answering, since a section held with skeletons while the set was
// still being asked for is the busy state and not this.
const expectNoCardsOnceSettled = (page: Page, player: FakePlayer) =>
	expectSettlesAt(player, () => cards(page).count(), 0);

test.describe("a set with nothing in it", () => {
	test.use({ playlistsFromRow: { p1: 4 } });

	test("an unmatched search draws no In your library section", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await searchFor(page, "zzqxjv");
		await expect(
			page.getByText("Nothing in your library matches that."),
		).toBeVisible();

		await expectNoCardsOnceSettled(page, player);
	});

	test("an empty playlist draws no In your library section", async ({
		page,
		player,
	}) => {
		expect(tracksIn(player, "p1"), "the fixture's playlist is empty").toEqual(
			[],
		);
		await page.goto(`/#/${guidOfPlaylist(player, "p1")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Default Playlist" }),
		).toBeVisible();
		await expect(page.getByText("This playlist is empty.")).toBeVisible();

		await expectNoCardsOnceSettled(page, player);
	});

	test("an artist with no tracks of their own draws no In your library section", async ({
		page,
		player,
	}) => {
		await openArtist(page, "Blood, Sweat & Tears");
		await expect(
			page.getByText("Nothing by them in your library."),
		).toBeVisible();

		await expectNoCardsOnceSettled(page, player);
	});
});

// Brand New has every figure Your history drew: a never-played track among played ones, a last-played
// date, and a total past a thousand, which English groups and Spanish does not.
test.describe("an artist with a never-played track and a last-played date", () => {
	test("the Overview has no Your history, and the cards carry its plays, never-played count, last-listened date and most-played track", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, "Brand New"));
		expect(set.unplayed, "the fixture's artist has one never played").toBe(1);
		await openArtist(page, "Brand New");
		await countedWithPlays(page);

		await expectFigure(
			card(page, "plays"),
			await numberIn(page, set.plays, "en"),
		);
		await expectFigure(
			card(page, "plays"),
			`Last listened ${await dateIn(page, set.lastPlayed!, "en")}`,
		);
		await expectFigure(card(page, "played"), `${set.unplayed} never played`);
		await expectFigure(card(page, "played"), `${set.played} of ${set.total}`);
		await expect(card(page, "most-played")).toContainText(
			set.mostPlayed!.title,
		);
		await expectFigure(
			card(page, "most-played"),
			`${set.mostPlayed!.plays} plays`,
		);

		await expect(
			page.getByRole("heading", { level: 2, name: "Discography" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Your history" }),
		).toHaveCount(0);
	});
});

const boxOf = async (locator: Locator) => {
	const box = await locator.boundingBox();
	if (!box) throw new Error("no box: the element is not drawn");
	return box;
};

// A pixel of slack, for a rule or a border either side drawn on the half pixel.
const SLACK = 1;

test.describe("on every view whose body is a track list", () => {
	for (const view of LIST_VIEWS)
		test(`${view.name} draws the cards between the header and the list's toolbar, on one line`, async ({
			page,
			player,
			isMobile,
		}) => {
			await openView(page, player, view);
			await expect(card(page, "played")).toContainText("%");
			await expect(cards(page)).toHaveCount(1);
			await expect(toolbar(page)).toBeVisible();

			const order = await cards(page).evaluate((section) => {
				const header = document.querySelector("main header");
				const layout = document.querySelector(
					'main [role="group"][aria-label="Track layout"]',
				);
				const follows = (a: Node | null, b: Node | null) =>
					a !== null &&
					b !== null &&
					(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !==
						0;
				return {
					afterHeader: follows(header, section),
					beforeToolbar: follows(section, layout),
				};
			});
			expect(order).toEqual({ afterHeader: true, beforeToolbar: true });

			const header = await boxOf(viewHeader(page));
			const row = await boxOf(cards(page));
			const tools = await boxOf(toolbar(page));
			expect(row.y, "the cards start below the header").toBeGreaterThanOrEqual(
				header.y + header.height - SLACK,
			);
			expect(
				row.y + row.height,
				"the cards end above the toolbar",
			).toBeLessThanOrEqual(tools.y + SLACK);
			const shape = await cards(page)
				.locator("[data-card]")
				.first()
				.evaluate((first) => {
					const line = first.parentElement as HTMLElement;
					const tops = [...line.querySelectorAll("[data-card]")].map((drawn) =>
						Math.round(drawn.getBoundingClientRect().top),
					);
					return {
						right: line.getBoundingClientRect().right,
						screen: document.documentElement.clientWidth,
						cards: tops.length,
						lines: new Set(tops).size,
						scrollsSideways: line.scrollWidth > line.clientWidth + 1,
					};
				});
			// A row wider than the screen inside a container that clips it is one line that does not
			// scroll: the cards past the edge are cut off with no way to reach them.
			expect(shape.right, "the row ends inside the screen").toBeLessThanOrEqual(
				shape.screen + SLACK,
			);
			if (isMobile)
				expect(
					shape.lines === 1 || shape.scrollsSideways,
					`${shape.cards} cards on ${shape.lines} lines, scrolling sideways: ${shape.scrollsSideways}`,
				).toBe(true);
			else expect(shape.lines, `${shape.cards} cards`).toBe(1);

			await expect
				.poll(() =>
					page.evaluate(
						() =>
							document.documentElement.scrollWidth -
							document.documentElement.clientWidth,
					),
				)
				.toBe(0);
		});
});

test.describe("the Genres card", () => {
	test("is absent on a genre page, while the other cards stay", async ({
		page,
		player,
	}) => {
		await openView(page, player, A_GENRE);
		await countedWithPlays(page);

		await expect(card(page, "plays")).toBeVisible();
		await expect(card(page, "genres")).toHaveCount(0);
	});

	test("on All music ends with All genres and the library's genre count, linking to the genres page", async ({
		page,
		player,
	}) => {
		const library = figuresOf(player.libraryTracks);
		expect(
			library.genres.length,
			"the fixture has more genres than the card shows",
		).toBeGreaterThan(4);
		await openView(page, player, ALL_MUSIC);
		await expect(genreLinks(page).first()).toBeVisible();

		await expect(genreLinks(page)).toHaveCount(5);
		const last = genreLinks(page).last();
		await expect(last).toHaveText(
			new RegExp(`^All genres\\s*${library.genres.length}$`),
		);
		await expect(last).toHaveAttribute("href", "#/genres");
	});
});

test.describe("a library with exactly as many genres as the card shows", () => {
	test.use({ libraryShape: { tracks: 40, albums: 4, genres: 4 } });

	test("All music's Genres card has no All genres at the end", async ({
		page,
		player,
	}) => {
		await openView(page, player, ALL_MUSIC);
		await expect(genreLinks(page).first()).toBeVisible();
		await counted(page);

		await expect(genreLinks(page)).toHaveCount(4);
		await expect(
			genreLinks(page).filter({ hasText: "All genres" }),
		).toHaveCount(0);
	});
});

// Copied from `touch-targets.spec.ts`, which does not export it: how far from a control's centre a
// tap still lands on it, read by hit-testing rather than off the box, so a hit area drawn around a
// glyph counts and a neighbour drawn over the edge does not.
const TOUCH_TARGET = 44;
const HIT_TEST_STEP = 0.5;
const ROUNDING = 0.5;

const tapExtent = (control: Locator) =>
	control.evaluate(
		(element, { reach, step }) => {
			const box = element.getBoundingClientRect();
			const centre = {
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
			};
			const reaches = (x: number, y: number) => {
				const hit = document.elementFromPoint(x, y);
				return hit !== null && element.contains(hit);
			};
			const span = (at: (offset: number) => boolean) => {
				let out = 0;
				while (out + step <= reach && at(out + step)) out += step;
				return out;
			};
			return {
				width:
					step +
					span((d) => reaches(centre.x - d, centre.y)) +
					span((d) => reaches(centre.x + d, centre.y)),
				height:
					step +
					span((d) => reaches(centre.x, centre.y - d)) +
					span((d) => reaches(centre.x, centre.y + d)),
			};
		},
		{ reach: TOUCH_TARGET, step: HIT_TEST_STEP },
	);

test.describe("on a phone", () => {
	test.skip(({ isMobile }) => !isMobile, "the desktop project has a mouse");

	test("every link in the cards reaches 44 px each way", async ({
		page,
		player,
	}) => {
		await openView(page, player, ALL_MUSIC);
		await expect(genreLinks(page).first()).toBeVisible();

		const links = cards(page).getByRole("link");
		const count = await links.count();
		// Four genres and All genres: a count of zero would pass the loop below without a tap.
		expect(count).toBeGreaterThanOrEqual(5);
		for (let index = 0; index < count; index += 1) {
			const link = links.nth(index);
			await link.scrollIntoViewIfNeeded();
			const name = (await link.textContent()) ?? `link ${index}`;
			const { width, height } = await tapExtent(link);
			expect(
				width,
				`${name} reaches ${width} px across`,
			).toBeGreaterThanOrEqual(TOUCH_TARGET - ROUNDING);
			expect(
				height,
				`${name} reaches ${height} px tall`,
			).toBeGreaterThanOrEqual(TOUCH_TARGET - ROUNDING);
		}
	});
});

const isQuestion = (path: string) => (request: { url: () => string }) =>
	new URL(request.url()).pathname === path;

// Recorded in the page from before the navigation, so a skeleton drawn for one frame and gone by the
// time an assertion could look is still seen.
const recordBusyCards = (page: Page) =>
	page.evaluate(() => {
		const seen = { busy: false };
		Reflect.set(window, "__cardsSeen", seen);
		const look = () => {
			if (
				document.querySelector(
					'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
				)
			)
				seen.busy = true;
		};
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
		});
		look();
	});

const busyCardsSeen = (page: Page) =>
	page.evaluate(
		() => (Reflect.get(window, "__cardsSeen") as { busy: boolean }).busy,
	);

const skeletonsIn = (scope: Locator) =>
	scope.evaluate(
		(element) =>
			[...element.querySelectorAll('[aria-hidden="true"]')].filter(
				(bar) =>
					bar.tagName.toLowerCase() !== "svg" &&
					bar.getBoundingClientRect().width > 0,
			).length,
	);

test.describe("while the figures are being counted", () => {
	test("every card holds its place with a skeleton, and the same cards carry the figures once counted", async ({
		page,
		player,
	}) => {
		const question = await holdRequests(page, isQuestion("/api/library/genre"));
		await openView(page, player, A_GENRE);
		await question.untilHeld();

		await expect(cards(page)).toBeVisible();
		await expect(
			page.locator(
				'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
			),
		).not.toHaveCount(0);
		// A genre page draws no Genres card, and the fixture's genre is all played and dated, so these
		// three are the cards the counted page draws.
		const holding = ["played", "plays", "most-played"] as const;
		for (const name of CARD_NAMES)
			await expect(card(page, name), name).toHaveCount(
				holding.includes(name as (typeof holding)[number]) ? 1 : 0,
			);
		for (const name of holding) {
			expect(await skeletonsIn(card(page, name)), name).toBeGreaterThan(0);
			// No figure drawn from an empty count: "0%" or "0 plays" before the answer is a lie.
			await expect(card(page, name), name).not.toContainText(/\d/);
		}

		question.releaseAll();
		await countedWithPlays(page);
		await expectFigure(card(page, "played"), "100%");
		for (const name of CARD_NAMES)
			await expect(card(page, name), name).toHaveCount(
				holding.includes(name as (typeof holding)[number]) ? 1 : 0,
			);
		await expect(
			page.locator(
				'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
			),
		).toHaveCount(0);
	});

	// All music counts from the library the page already holds, and its header line draws at once on a
	// second visit today. The cards are held to the same.
	test("a second visit draws the cards at once from the figures kept, with no skeleton", async ({
		page,
		player,
	}) => {
		const library = figuresOf(player.libraryTracks);
		await openView(page, player, ALL_MUSIC);
		await countedWithPlays(page);
		await page.evaluate(() => {
			location.hash = "#/genre/Grunge";
		});
		await expect(
			page.getByRole("heading", { level: 1, name: "Grunge" }),
		).toBeVisible();
		await countedWithPlays(page);

		await recordBusyCards(page);
		await page.goBack();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectFigure(
			card(page, "played"),
			`${library.played} of ${library.total}`,
		);
		expect(await busyCardsSeen(page)).toBe(false);
	});
});

// What drew in the cards row from the moment the rows were let go: any card carrying a figure while the
// row was still busy, and which cards were there the first moment it was not. Recorded in the page, so
// a card that pops in one frame after the others is seen even when it has settled before a read.
const recordArrival = (page: Page) =>
	page.evaluate(() => {
		const seen = {
			figuresWhileBusy: [] as string[],
			firstDrawn: null as string[] | null,
		};
		Reflect.set(window, "__cardsArrival", seen);
		const look = () => {
			const section = document.querySelector("[data-library-cards]");
			if (!section) return;
			const names = [...section.querySelectorAll("[data-card]")].map(
				(drawn) => drawn.getAttribute("data-card") ?? "",
			);
			const isBusy =
				section.matches('[aria-busy="true"]') ||
				section.querySelector('[aria-busy="true"]') !== null;
			if (isBusy) {
				for (const drawn of section.querySelectorAll("[data-card]")) {
					const name = drawn.getAttribute("data-card") ?? "";
					if (
						/\d/.test(drawn.textContent ?? "") &&
						!seen.figuresWhileBusy.includes(name)
					)
						seen.figuresWhileBusy.push(name);
				}
			} else if (seen.firstDrawn === null) seen.firstDrawn = names;
		};
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});
		look();
	});

const arrival = (page: Page) =>
	page.evaluate(
		() =>
			Reflect.get(window, "__cardsArrival") as {
				figuresWhileBusy: string[];
				firstDrawn: string[] | null;
			},
	);

const drawnCards = (page: Page) =>
	cards(page)
		.locator("[data-card]")
		.evaluateAll((drawn) =>
			drawn.map((element) => element.getAttribute("data-card") ?? ""),
		);

test.describe("a playlist whose rows are still arriving", () => {
	test("the cards hold skeletons with no figure, and every card arrives in the same frame once the rows have", async ({
		page,
		player,
	}) => {
		const set = figuresOf(tracksIn(player, "p7"));
		const guid = guidOfPlaylist(player, "p7");
		const items = await holdRequests(
			page,
			(request) =>
				request.method() === "GET" &&
				new URL(request.url()).pathname === `/api/playlists/${guid}/items`,
		);
		await page.goto(`/#/${guid}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
		await items.untilHeld();

		await expect(cards(page)).toBeVisible();
		await expect(
			page.locator(
				'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
			),
		).not.toHaveCount(0);
		const holding = await drawnCards(page);
		expect(holding.length).toBeGreaterThan(0);
		for (const name of holding) {
			const held = card(page, name as CardName);
			expect(await skeletonsIn(held), name).toBeGreaterThan(0);
			// The playlist knows it holds 54 before a row has arrived, and "54 of 54" with "0%" beside it
			// is a share counted over the rows so far against a total that is not theirs.
			await expect(held, name).not.toContainText(/\d/);
		}

		await recordArrival(page);
		items.releaseAll();
		await countedWithPlays(page);
		await expectFigure(card(page, "played"), `${set.played} of ${set.total}`);
		await expectFigure(
			card(page, "plays"),
			await numberIn(page, set.plays, "en"),
		);

		const final = await drawnCards(page);
		const { figuresWhileBusy, firstDrawn } = await arrival(page);
		expect(
			figuresWhileBusy,
			"cards drawn with figures while still busy",
		).toEqual([]);
		expect(
			firstDrawn,
			"the cards there the moment the row stopped being busy",
		).toEqual(final);
		expect(
			final,
			"the cards that held places are the cards that arrived",
		).toEqual(holding);
	});
});

// A removal shrinks the rows at once, and the playlist's own item count moves only when the
// playlist list is read again. Figures that wait for the two to agree go blank on every removal, for as
// long as that read takes.
const recordBlanking = (page: Page) =>
	page.evaluate(() => {
		const seen = { cardsBusy: false, figureLost: false };
		Reflect.set(window, "__blanking", seen);
		const look = () => {
			if (
				document.querySelector(
					'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
				)
			)
				seen.cardsBusy = true;
			if (
				!document.querySelector(
					'main header p[data-figures] span[data-figure="tracks"]',
				)
			)
				seen.figureLost = true;
		};
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});
		look();
	});

test.describe("removing a row from a playlist", () => {
	test("the cards and the figure line keep their figures through the removal, and count one track fewer once it lands", async ({
		page,
		player,
		isMobile,
	}) => {
		const key = "p5";
		const guid = guidOfPlaylist(player, key);
		const before = figuresOf(tracksIn(player, key));
		await page.goto(`/#/${guid}`);
		await expect(trackRow(page, 0)).toBeAttached();
		await countedWithPlays(page);
		await expect(tracksFigure(page)).toHaveText(`${before.total} tracks`);

		const list = await holdRequests(
			page,
			(request) =>
				request.method() === "GET" &&
				new URL(request.url()).pathname === "/api/playlists",
		);
		const titles = titlesIn(player, key).map(String);
		await openRowMenu(page, isMobile, 1, "Add to queue");
		await recordBlanking(page);
		await page.getByRole("menuitem", { name: "Remove from playlist" }).click();

		await expectSettlesAt(
			player,
			() => titlesIn(player, key).map(String),
			titles.filter((_, at) => at !== 1),
		);
		const after = figuresOf(tracksIn(player, key));
		expect(after.total).toBe(before.total - 1);
		await expect(tracksFigure(page)).toHaveText(`${after.total} tracks`);
		await expectFigure(
			card(page, "played"),
			`${after.played} of ${after.total}`,
		);
		// The playlist list is asked for again once the player reports the change, and the figures
		// have to hold through however long that read takes: read while it is held, then after.
		await list.untilHeld();
		await expect(tracksFigure(page)).toHaveText(`${after.total} tracks`);
		expect(
			await page.evaluate(() => Reflect.get(window, "__blanking")),
			"while the playlist list was held",
		).toEqual({ cardsBusy: false, figureLost: false });
		list.releaseAll();
		await untilQuiet(player);
		await expect(tracksFigure(page)).toHaveText(`${after.total} tracks`);
		expect(
			await page.evaluate(() => Reflect.get(window, "__blanking")),
			"once the playlist list had answered",
		).toEqual({ cardsBusy: false, figureLost: false });
	});
});

test.describe("in Spanish", () => {
	test.use({
		settings: { "jean.locale": "es" },
	});

	test("the heading and the labels are Spanish, and the figures and the date are in Spanish formats", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, "Brand New"));
		await openArtist(page, "Brand New");
		await expect(page.locator("html")).toHaveAttribute("lang", "es");
		await expect(card(page, "played")).toContainText("%");

		await expect(
			page.getByRole("region", { name: "En tu biblioteca" }),
		).toBeVisible();
		await expect(
			cards(page).getByRole("heading", { level: 2, name: "En tu biblioteca" }),
		).toBeVisible();
		const labels: [CardName, string][] = [
			["played", "Escuchado"],
			["plays", "Reproducciones"],
			["most-played", "Más escuchado"],
			["genres", "Géneros"],
		];
		for (const [name, label] of labels)
			await expect(
				card(page, name).getByText(label, { exact: true }),
				name,
			).toBeVisible();

		// 1,315 in English and 1315 in Spanish, which groups only from five digits.
		const plays = await numberIn(page, set.plays, "es");
		expect(plays).not.toBe(await numberIn(page, set.plays, "en"));
		await expectFigure(card(page, "plays"), plays);
		await expect(card(page, "plays")).toContainText(
			await dateIn(page, set.lastPlayed!, "es"),
		);
		await expect(cards(page)).not.toContainText("Last listened");
	});
});
