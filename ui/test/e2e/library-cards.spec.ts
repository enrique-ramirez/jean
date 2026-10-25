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
	test,
	titleOf,
	viewHeader,
} from "./fixtures.ts";
import { latestAnswer, recordLibraryTraffic } from "./libraryLists.ts";
import {
	ARTIST_ON_THREE_RECORDS,
	type ArtistAnswer,
	NOTHING_TO_SUM,
	THREE_RECORDS,
} from "./setFigures.ts";
import { expectTapTarget } from "./tapping.ts";

// Every expected figure is counted here from the fake's own tracks, so a figure the cards draw is
// checked against the fixture rather than against a number copied out of a screenshot.

type Track = Record<string, string>;

type CardName = "played" | "plays" | "most-played" | "genres";

const CARD_NAMES: CardName[] = ["played", "plays", "most-played", "genres"];

const cards = (page: Page) => page.locator("[data-library-cards]");

const card = (page: Page, name: CardName) =>
	cards(page).locator(`[data-card="${name}"]`);

const genreLinks = (page: Page) => card(page, "genres").getByRole("link");

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

const byArtist = (player: FakePlayer, artist: string) =>
	player.libraryTracks.filter((track) => fieldOf(track, "%artist%") === artist);

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

const countedWithPlays = (page: Page) =>
	expect(card(page, "played")).toContainText("%");

const counted = (page: Page) => expect(tracksFigure(page)).toBeVisible();

const THE_ARTIST = "Have a Nice Life";

// The artist's other five tracks keep their one tag, so the genres run five, three, two, two and one:
// the card's fourth and fifth fall on two and one, not on a tie.
const FIVE_GENRES: Record<string, Track> = {
	Bloodhail: { "%genre%": "Shoegaze" },
	"The Big Gloom": { "%genre%": "Shoegaze" },
	Hunter: { "%genre%": "Shoegaze" },
	Telephony: { "%genre%": "Drone" },
	"There Is No Food": { "%genre%": "Drone" },
	"Deep, Deep": { "%genre%": "Ambient" },
	"The Future": { "%genre%": "Ambient" },
	Earthmover: { "%genre%": "Noise" },
};

interface View {
	name: string;
	path: (player: FakePlayer) => string;
	title: string;
}

const LIST_VIEWS: View[] = [
	{
		name: "an album",
		path: () => albumRoute("Brand New", "Deja Entendu"),
		title: "Deja Entendu",
	},
	{
		name: "a genre",
		path: () => genreRoute("Rock En Español"),
		title: "Rock En Español",
	},
	{ name: "a shelf", path: () => shelfRoute("top"), title: "Most played" },
	{
		name: "a playlist",
		path: (player) => guidOfPlaylist(player, "p7"),
		title: "Library",
	},
	{ name: "All music", path: () => "all", title: "All music" },
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

test.describe("the cards", () => {
	test("Played gives the share played as a percentage, how many of how many, the never-played count and a meter", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, THE_ARTIST));
		await openArtist(page, THE_ARTIST);
		await countedWithPlays(page);

		const played = card(page, "played");
		await expect(played.getByText("Played", { exact: true })).toBeVisible();
		await expectFigure(played, `${Math.round(set.share * 100)}%`);
		await expectFigure(played, `${set.played} of ${set.total}`);
		await expectFigure(played, `${set.unplayed} never played`);

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
		const set = figuresOf(byArtist(player, THE_ARTIST));
		await openArtist(page, THE_ARTIST);
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
		const set = figuresOf(byArtist(player, THE_ARTIST));
		await openArtist(page, THE_ARTIST);
		await countedWithPlays(page);

		const most = card(page, "most-played");
		await expect(most.getByText("Most played", { exact: true })).toBeVisible();
		await expect(most).toContainText(set.mostPlayed!.title);
		await expectFigure(most, `${set.mostPlayed!.plays} plays`);
	});
});

test.describe("an artist tagged with five genres", () => {
	test.use({ retagged: FIVE_GENRES });

	test("Genres links the four biggest genres to their pages, each with its share", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, THE_ARTIST));
		expect(set.genres.length, "the fixture tags the artist five ways").toBe(5);
		await openArtist(page, THE_ARTIST);
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
		await expect(
			genreLinks(page).filter({ hasText: set.genres[4].name }),
		).toHaveCount(0);
	});

	test.describe("on a phone", () => {
		test.skip(({ isMobile }) => !isMobile, "the desktop project has a mouse");

		test("every link in the cards reaches 44 px each way", async ({ page }) => {
			await openArtist(page, THE_ARTIST);
			await expect(genreLinks(page).first()).toBeVisible();

			const links = cards(page).getByRole("link");
			const count = await links.count();
			expect(count).toBe(4);
			for (let index = 0; index < count; index += 1) {
				const link = links.nth(index);
				await link.scrollIntoViewIfNeeded();
				await expectTapTarget(
					link,
					(await link.textContent()) ?? `link ${index}`,
				);
			}
		});
	});
});

test.describe("an artist nobody has played", () => {
	test("draws no Most played, and Played says none of them", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, "As Tall as Lions"));
		expect(set.mostPlayed, "the fixture's artist is never played").toBeNull();
		await openArtist(page, "As Tall as Lions");
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
		const set = figuresOf(byArtist(player, THE_ARTIST));
		await openArtist(page, THE_ARTIST);
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
	}) => {
		await openArtist(page, THE_ARTIST);
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

// With play counts declared and no track of the artist's own, Played and Plays have nothing to say:
// "0% / 0 of 0 / 0 never played / Plays 0" is a row of cards about nothing. Read once the page has said
// so and the player has stopped answering, since a section held with skeletons while the artist was
// still being asked for is the busy state and not this.
test.describe("an artist with no tracks of their own", () => {
	test("draws no In your library section", async ({ page, player }) => {
		await openArtist(page, "Blood, Sweat & Tears");
		await expect(
			page.getByText("Nothing by them in your library."),
		).toBeVisible();

		await expectSettlesAt(player, () => cards(page).count(), 0);
	});
});

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

test.describe("on every view whose body is a track list", () => {
	for (const view of LIST_VIEWS)
		test(`${view.name} draws no In your library section`, async ({
			page,
			player,
		}) => {
			await page.goto(`/#/${view.path(player)}`);
			await expect(
				page.getByRole("heading", { level: 1, name: view.title }),
			).toBeVisible();
			await counted(page);
			await expect(
				page.getByRole("group", { name: "Track layout" }),
			).toBeVisible();

			await expect(cards(page)).toHaveCount(0);
			await expect(
				page.getByRole("heading", { name: "In your library" }),
			).toHaveCount(0);
		});
});

const skeletonsIn = (scope: Locator) =>
	scope.evaluate(
		(element) =>
			[...element.querySelectorAll('[aria-hidden="true"]')].filter(
				(bar) =>
					bar.tagName.toLowerCase() !== "svg" &&
					bar.getBoundingClientRect().width > 0,
			).length,
	);

const busyCards = (page: Page) =>
	page.locator(
		'[data-library-cards][aria-busy="true"], [data-library-cards] [aria-busy="true"]',
	);

test.describe("while the figures are being counted", () => {
	test("every card holds its place with a skeleton, and the same cards carry the figures once counted", async ({
		page,
		player,
	}) => {
		const set = figuresOf(byArtist(player, THE_ARTIST));
		const question = await holdRequests(
			page,
			(request) => new URL(request.url()).pathname === "/api/library/artist",
		);
		await openArtist(page, THE_ARTIST);
		await question.untilHeld();

		await expect(cards(page)).toBeVisible();
		await expect(busyCards(page)).not.toHaveCount(0);
		for (const name of CARD_NAMES) {
			await expect(card(page, name), name).toHaveCount(1);
			expect(await skeletonsIn(card(page, name)), name).toBeGreaterThan(0);
			// No figure drawn from an empty count: "0%" or "0 plays" before the answer is a lie.
			await expect(card(page, name), name).not.toContainText(/\d/);
		}

		question.releaseAll();
		await countedWithPlays(page);
		await expectFigure(card(page, "played"), `${set.played} of ${set.total}`);
		for (const name of CARD_NAMES)
			await expect(card(page, name), name).toHaveCount(1);
		await expect(busyCards(page)).toHaveCount(0);
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

const dateOfStamp = (page: Page, at: number) =>
	page.evaluate(
		([at, parts]) => new Intl.DateTimeFormat("en", parts).format(at),
		[at, DATE_PARTS] as const,
	);

// The answer computes the cards over every track of the artist's, the shared one
// on Lafcadio among them, so a count over their own tracks draws other figures; and with the rows and
// the whole library held there is nothing on the page to count from at all.
test.describe("the cards, from the artist answer", () => {
	test.use({ retagged: THREE_RECORDS, fooJean: NOTHING_TO_SUM });

	test("carry the answer's share played, plays, never played, last listened, most played track and largest genres", async ({
		page,
	}) => {
		const answered = recordLibraryTraffic(page);
		await openArtist(page, ARTIST_ON_THREE_RECORDS);
		const { figures, cards: answer } = await latestAnswer<ArtistAnswer>(
			answered,
			"GET /api/library/artist",
		);
		expect(answer.neverPlayed, "every track is played").toBeGreaterThan(0);
		expect(answer.lastPlayed).not.toBeNull();
		expect(answer.mostPlayed).not.toBeNull();
		expect(answer.topGenres.length).toBeGreaterThan(1);

		const played = card(page, "played");
		await expectFigure(played, `${Math.round(answer.playedShare * 100)}%`);
		await expectFigure(
			played,
			`${figures.trackCount - answer.neverPlayed} of ${figures.trackCount}`,
		);
		await expectFigure(played, `${answer.neverPlayed} never played`);

		const plays = card(page, "plays");
		await expectFigure(plays, await numberIn(page, answer.plays, "en"));
		await expect(plays).toContainText(
			`Last listened ${await dateOfStamp(page, answer.lastPlayed!)}`,
		);

		const most = card(page, "most-played");
		await expect(most).toContainText(answer.mostPlayed!.title);
		await expectFigure(most, `${answer.mostPlayed!.plays} plays`);

		await expect(genreLinks(page)).toHaveCount(answer.topGenres.length);
		for (const genre of answer.topGenres)
			await expect(
				genreLinkNamed(page, genre.name, genre.share),
				`${genre.name} at ${genre.share}%`,
			).toHaveAttribute("href", `#/${genreRoute(genre.name)}`);
	});
});
