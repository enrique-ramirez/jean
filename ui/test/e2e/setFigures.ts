import { everyValueOf } from "../../src/shared/api/multiValue.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import { expect, viewHeader } from "./fixtures.ts";

// What a list's header draws under its name, and the answer it draws it from, for the specs of
// All Music, the album, artist, genre, shelf and search pages.

export interface SetFigures {
	albumCount: number;
	trackCount: number;
	seconds: number;
	earliestYear: number | null;
	latestYear: number | null;
}

export const NOTHING_TO_SUM = { holdRows: true };

type Figure = "albums" | "tracks" | "duration" | "span";

const figureLine = (page: Page) => viewHeader(page).locator("p[data-figures]");

const figure = (page: Page, name: Figure) =>
	figureLine(page).locator(`span[data-figure="${name}"]`);

const counted = (count: number, one: string, many: string) =>
	`${new Intl.NumberFormat("en").format(count)} ${count === 1 ? one : many}`;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const durationOf = (seconds: number) => {
	const days = Math.floor(seconds / DAY);
	const hours = Math.floor((seconds % DAY) / HOUR);
	const minutes = Math.floor((seconds % HOUR) / MINUTE);
	if (days > 0) return `${counted(days, "day", "days")} ${hours} hr`;
	if (hours > 0) return `${hours} hr ${minutes} min`;
	return `${minutes} min`;
};

const spanOf = ({ earliestYear, latestYear }: SetFigures) =>
	earliestYear === latestYear
		? `${earliestYear}`
		: `${earliestYear}-${latestYear}`;

export const expectTheFiguresOf = async (page: Page, figures: SetFigures) => {
	await expect(figure(page, "tracks")).toHaveText(
		counted(figures.trackCount, "track", "tracks"),
	);
	if (figures.albumCount > 1)
		await expect(figure(page, "albums")).toHaveText(
			counted(figures.albumCount, "album", "albums"),
		);
	else await expect(figure(page, "albums")).toHaveCount(0);
	if (figures.seconds > 0)
		await expect(figure(page, "duration")).toHaveText(
			durationOf(figures.seconds),
		);
	else await expect(figure(page, "duration")).toHaveCount(0);
	if (figures.earliestYear !== null && figures.latestYear !== null)
		await expect(figure(page, "span")).toHaveText(spanOf(figures));
	else await expect(figure(page, "span")).toHaveCount(0);
};

// Read once the figures are on screen: a window that landed would be rows the header could have summed.
export const expectNoRowsLanded = (player: FakePlayer) =>
	expect(
		player.fooJean.rowsHeld.length,
		"no list asked for rows, so nothing proves the header summed none",
	).toBeGreaterThan(0);

export interface ArtistAnswer {
	figures: SetFigures;
	cards: {
		playedShare: number;
		plays: number;
		neverPlayed: number;
		lastPlayed: number | null;
		mostPlayed: { ordinal: number; title: string; plays: number } | null;
		topGenres: { name: string; count: number; share: number }[];
	};
	records: Record<
		"own" | "shared",
		{
			album: string;
			artist: string | null;
			year: number | null;
			cover: string;
			trackCount: number;
		}[]
	>;
}

// Brand New's own Deja Entendu, a track of Jar Of Flies retagged as theirs, and one of Lafcadio they
// share with As Tall as Lions. Jar Of Flies comes first in the library and last by year, so records
// in the library's order are in the wrong order; and the cards and the header count the shared
// track, which a count over their own tracks leaves out.
export const ARTIST_ON_THREE_RECORDS = "Brand New";

export const THREE_RECORDS = {
	"Rotten Apple": {
		"%artist%": ARTIST_ON_THREE_RECORDS,
		"%album artist%": ARTIST_ON_THREE_RECORDS,
	},
	"Break Blossom": {
		"%artist%": `${ARTIST_ON_THREE_RECORDS} & As Tall as Lions`,
		[everyValueOf("artists")]: [
			ARTIST_ON_THREE_RECORDS,
			"As Tall as Lions",
		].join(String.fromCharCode(31)),
	},
};
