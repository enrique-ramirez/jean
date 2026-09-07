import { type Album, percentile } from "@/domain/track/albums";
import type { Phrase } from "@/shared/i18n/en";
import type { Translate } from "@/shared/i18n/useTranslate";
import { describeWhen, yearOf } from "./when";

type ShelfPhrase = Extract<
	Phrase,
	`shelf.${string}.title` | `shelf.${string}.blurb`
>;

export interface Shelf {
	id: string;
	title: ShelfPhrase;
	blurb: ShelfPhrase;
	pick: (albums: Album[]) => Album[];
	caption: (album: Album, t: Translate, locale: string) => string | null;
}

export interface FilledShelf<A extends Album = Album> extends Shelf {
	albums: A[];
	total: number;
}

type WithBitrate = Album & { bitrate: number };
type WithRating = Album & { rating: number };

const LIMIT = 24;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const MINIMUM = 4;

const shelf = (
	id: string,
	title: ShelfPhrase,
	blurb: ShelfPhrase,
	pick: Shelf["pick"],
	caption: Shelf["caption"],
): Shelf => ({ id, title, blurb, pick, caption });

const byPlays = (a: Album, b: Album) => b.plays - a.plays;
const byRecent = (a: Album, b: Album) => b.lastPlayed - a.lastPlayed;
// `sort(() => Math.random() - 0.5)` is biased: the result depends on the comparison order the engine happens to use.
const shuffled = <T>(items: T[]): T[] =>
	items
		.map((item) => ({ item, at: Math.random() }))
		.sort((a, b) => a.at - b.at)
		.map(({ item }) => item);

export const SHELVES: Shelf[] = [
	shelf(
		"recent",
		"shelf.recent.title",
		"shelf.recent.blurb",
		(albums) => albums.filter((album) => album.lastPlayed > 0).sort(byRecent),
		(album, t, locale) =>
			describeWhen(album.lastPlayed, locale, t("when.today")),
	),

	shelf(
		"top",
		"shelf.top.title",
		"shelf.top.blurb",
		(albums) => albums.filter((album) => album.plays > 0).sort(byPlays),
		(album, t) => t("shelf.plays", { count: Math.round(album.plays) }),
	),

	shelf(
		"rated",
		"shelf.rated.title",
		"shelf.rated.blurb",
		(albums) => {
			const rated = albums.filter(
				(album): album is WithRating => album.ratedCount >= 2,
			);
			if (rated.length < 8) return [];

			const good = percentile(
				rated.map((album) => album.rating),
				0.5,
			);
			return rated
				.filter((album) => album.rating >= good)
				.sort((a, b) => b.rating - a.rating || b.ratedCount - a.ratedCount);
		},
		(album, t) =>
			t("shelf.ratedCaption", {
				rating: (album as WithRating).rating.toFixed(1),
				count: album.ratedCount,
			}),
	),
	shelf(
		"loved",
		"shelf.loved.title",
		"shelf.loved.blurb",
		(albums) => {
			const played = albums.filter(
				(album) =>
					album.plays > 0 && album.lastPlayed > 0 && album.trackCount >= 4,
			);
			if (played.length < 8) return [];

			const busy = percentile(
				played.map((album) => album.playsPerTrack),
				0.75,
			);
			const silent = Date.now() - 1.5 * YEAR_MS;

			return played
				.filter(
					(album) => album.playsPerTrack >= busy && album.lastPlayed <= silent,
				)
				.sort(byPlays);
		},
		(album, t) => t("shelf.notSince", { year: yearOf(album.lastPlayed) ?? "" }),
	),

	shelf(
		"upgrade",
		"shelf.upgrade.title",
		"shelf.upgrade.blurb",
		(albums) => {
			const lossy = albums.filter(
				(album): album is WithBitrate =>
					!album.lossless &&
					Boolean(album.bitrate) &&
					album.plays > 0 &&
					album.trackCount >= 4,
			);
			if (lossy.length < 8) return [];

			const busy = percentile(
				lossy.map((album) => album.playsPerTrack),
				0.75,
			);
			const poor = percentile(
				lossy.map((album) => album.bitrate),
				0.25,
			);

			return lossy
				.filter((album) => album.playsPerTrack >= busy && album.bitrate <= poor)
				.sort(byPlays);
		},
		(album, t) =>
			t("shelf.upgradeCaption", {
				bitrate: Math.round((album as WithBitrate).bitrate),
				plays: t("shelf.plays", { count: Math.round(album.plays) }),
			}),
	),

	shelf(
		"unopened",
		"shelf.unopened.title",
		"shelf.unopened.blurb",
		(albums) =>
			// With no playback-statistics component every album reads as zero, and the filter would offer the whole library.
			albums.some((album) => album.plays > 0)
				? albums
						.filter((album) => album.plays === 0)
						.sort((a, b) => b.trackCount - a.trackCount)
				: [],
		(album, t) =>
			t("view.trackCount", {
				count: album.trackCount,
				total: album.trackCount,
			}),
	),
];

const STARTER = shelf(
	"starter",
	"shelf.starter.title",
	"shelf.starter.blurb",
	shuffled,
	(album, t) =>
		t("view.trackCount", { count: album.trackCount, total: album.trackCount }),
);

const fill = <A extends Album>(
	entry: Shelf,
	albums: A[],
): FilledShelf<A> | null => {
	const picked = entry.pick(albums) as A[];
	return picked.length < MINIMUM
		? null
		: { ...entry, albums: picked.slice(0, LIMIT), total: picked.length };
};

export function buildShelves<A extends Album>(albums: A[]): FilledShelf<A>[] {
	if (albums.length === 0) return [];

	const built = SHELVES.map((entry) => fill(entry, albums)).filter(
		(entry) => entry !== null,
	);
	if (built.length > 0) return built;

	return [fill(STARTER, albums)].filter((entry) => entry !== null);
}

// Ascending, not the order the shelf is drawn in: beefweb's `add-from-library` ignores the order of `items` and adds them in the library's own.
export function refsOfShelf(shelf: FilledShelf<Album>) {
	return Int32Array.from(
		shelf.albums.flatMap((album) => [...album.refs]),
	).sort();
}
