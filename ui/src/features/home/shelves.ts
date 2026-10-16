import { type Album, percentile } from "@/domain/track/albums";
import { FIELD } from "@/domain/track/fields";
import { isLoaded, type LibraryColumns } from "@/domain/track/libraryColumns";
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
	minimum: number;
	needs: readonly number[];
}

export interface FilledShelf<A extends Album = Album> extends Shelf {
	albums: A[];
	total: number;
	isPending: boolean;
}

type WithBitrate = Album & { bitrate: number };
type WithRating = Album & { rating: number };

const LIMIT = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const RECENT_WINDOW_MS = 30 * DAY_MS;
const ADDED_WINDOW_MS = 28 * DAY_MS;
const FIRST_RUN_GAP_MS = 60 * 1000;
const FIRST_RUN_SHARE = 0.25;
const FORGOTTEN_AFTER_MS = 1.5 * YEAR_MS;

const MINIMUM = 4;

const shelf = (
	id: string,
	title: ShelfPhrase,
	blurb: ShelfPhrase,
	pick: Shelf["pick"],
	caption: Shelf["caption"],
	minimum = MINIMUM,
	needs: readonly number[] = [],
): Shelf => ({ id, title, blurb, pick, caption, minimum, needs });

// foo_playcount's first run stamps every track already in the library with that moment, one after
// another, so the largest unbroken run of arrivals is when it was installed if the run is a good
// share of the library.
function firstRunOf(arrivals: number[]): { from: number; to: number } | null {
	const sorted = Float64Array.from(arrivals).sort();
	let run = { from: 0, to: 0, count: 0 };
	let start = 0;
	for (let at = 1; at <= sorted.length; at += 1) {
		if (at < sorted.length && sorted[at] - sorted[at - 1] <= FIRST_RUN_GAP_MS)
			continue;
		if (at - start > run.count)
			run = { from: sorted[start], to: sorted[at - 1], count: at - start };
		start = at;
	}
	return run.count > 0 && run.count >= sorted.length * FIRST_RUN_SHARE
		? run
		: null;
}

const byPlays = (a: Album, b: Album) => b.plays - a.plays;
const byRecent = (a: Album, b: Album) => b.lastPlayed - a.lastPlayed;
const byArrival = (a: Album, b: Album) => b.added - a.added;
// `sort(() => Math.random() - 0.5)` is biased: the result depends on the comparison order the engine happens to use.
const shuffled = <T>(items: T[]): T[] =>
	items
		.map((item) => ({ item, at: Math.random() }))
		.sort((a, b) => a.at - b.at)
		.map(({ item }) => item);

export const SHELVES: Shelf[] = [
	shelf(
		"added",
		"shelf.added.title",
		"shelf.added.blurb",
		(albums) => {
			const since = Date.now() - ADDED_WINDOW_MS;
			const dated = albums.filter((album) => album.added > since);
			const firstRun = firstRunOf(
				albums.filter((album) => album.added > 0).map((album) => album.added),
			);
			return dated
				.filter(
					(album) =>
						!firstRun ||
						album.added < firstRun.from ||
						album.added > firstRun.to,
				)
				.sort(byArrival);
		},
		(album, t, locale) => describeWhen(album.added, locale, t("when.today")),
		1,
		[FIELD.added],
	),

	shelf(
		"recent",
		"shelf.recent.title",
		"shelf.recent.blurb",
		(albums) => {
			const since = Date.now() - RECENT_WINDOW_MS;
			return albums.filter((album) => album.lastPlayed > since).sort(byRecent);
		},
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
			const silent = Date.now() - FORGOTTEN_AFTER_MS;

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
		MINIMUM,
		[FIELD.codec, FIELD.bitrate],
	),

	shelf(
		"unopened",
		"shelf.unopened.title",
		"shelf.unopened.blurb",
		(albums) =>
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
	columns: LibraryColumns | null,
): FilledShelf<A> | null => {
	if (columns && !isLoaded(columns, entry.needs))
		return { ...entry, albums: [], total: 0, isPending: true };

	const picked = entry.pick(albums) as A[];
	return picked.length < entry.minimum
		? null
		: {
				...entry,
				albums: picked.slice(0, LIMIT),
				total: picked.length,
				isPending: false,
			};
};

export function buildShelves<A extends Album>(
	albums: A[],
	columns: LibraryColumns | null,
): FilledShelf<A>[] {
	if (albums.length === 0) return [];

	const built = SHELVES.map((entry) => fill(entry, albums, columns)).filter(
		(entry) => entry !== null,
	);
	if (built.length > 0) return built;

	return [fill(STARTER, albums, columns)].filter((entry) => entry !== null);
}

// Library order, not the order the shelf is drawn in. Ascending is also the only form `encodeFill`
// can send as runs or a bitset, so a shelf costs one pair per album rather than one ordinal per row.
export function refsOfShelf(shelf: FilledShelf<Album>) {
	return Int32Array.from(
		shelf.albums.flatMap((album) => [...album.refs]),
	).sort();
}
