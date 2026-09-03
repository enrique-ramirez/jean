import { plural } from "@/shared/lib/text";
import { type Album, percentile } from "./albums";
import { describeWhen, yearOf } from "./when";

// A shelf is a filter, a title, and a sentence it can say about each entry.
export interface Shelf {
	id: string;
	title: string;
	blurb: string;
	pick: (albums: Album[]) => Album[];
	caption: (album: Album) => string | null;
}

// Generic in the album, so a shelf built from covered albums stays covered downstream: the picks only filter and sort.
export interface FilledShelf<A extends Album = Album> extends Shelf {
	albums: A[];
	total: number;
}

// The filters already guarantee these, but the aggregate type cannot say so.
type WithBitrate = Album & { bitrate: number };
type WithRating = Album & { rating: number };

const LIMIT = 24;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// A shelf yielding fewer than this is dropped rather than shown thin.
const MINIMUM = 4;

// Thresholds are percentiles, so a shelf fills at any scale of play counts. A percentile only promises something qualifies, so a shelf claiming something about time carries an absolute floor too.
const shelf = (
	id: string,
	title: string,
	blurb: string,
	pick: Shelf["pick"],
	caption: Shelf["caption"],
): Shelf => ({ id, title, blurb, pick, caption });

const byPlays = (a: Album, b: Album) => b.plays - a.plays;
const byRecent = (a: Album, b: Album) => b.lastPlayed - a.lastPlayed;
const plays = (count: number) => plural(Math.round(count), "play");

// Decorate, sort, undecorate. `sort(() => Math.random() - 0.5)` is biased: the result depends on the comparison order the engine happens to use.
const shuffled = <T>(items: T[]): T[] =>
	items
		.map((item) => ({ item, at: Math.random() }))
		.sort((a, b) => a.at - b.at)
		.map(({ item }) => item);

// Order is tab order. The ids are the `#/shelf/<id>` route, so renaming one breaks a link a title change does not.
export const SHELVES: Shelf[] = [
	shelf(
		"recent",
		"Recently played",
		"Where you have been lately",
		(albums) => albums.filter((album) => album.lastPlayed > 0).sort(byRecent),
		(album) => describeWhen(album.lastPlayed),
	),

	shelf(
		"top",
		"Most played",
		"The records you keep coming back to",
		(albums) => albums.filter((album) => album.plays > 0).sort(byPlays),
		(album) => plays(album.plays),
	),

	// Ratings are sparse and lopsided, so an average alone sorts a flat tie; the second key is how many tracks were starred.
	shelf(
		"rated",
		"Your favourites",
		"Albums you marked up yourself",
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
		(album) =>
			`${(album as WithRating).rating.toFixed(1)} stars, ${album.ratedCount} rated`,
	),
	// Plays per track, or a long soundtrack wins on volume alone.
	shelf(
		"loved",
		"Remember these?",
		"Played to death, then put down",
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
			// The floor is what makes the title true: without it the shelf offers records from last year and calls them forgotten.
			const silent = Date.now() - 1.5 * YEAR_MS;

			return played
				.filter(
					(album) => album.playsPerTrack >= busy && album.lastPlayed <= silent,
				)
				.sort(byPlays);
		},
		(album) => `Not since ${yearOf(album.lastPlayed)}`,
	),

	shelf(
		"upgrade",
		"Time for an upgrade",
		"You play these a lot, and they are low bitrate",
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
		(album) =>
			`${Math.round((album as WithBitrate).bitrate)} kbps, ${plays(album.plays)}`,
	),

	shelf(
		"unopened",
		"Never listened",
		"In your library, never played",
		(albums) =>
			// With no playback-statistics component every album reads as zero, so this would offer the whole library and call it untouched.
			albums.some((album) => album.plays > 0)
				? albums
						.filter((album) => album.plays === 0)
						.sort((a, b) => b.trackCount - a.trackCount)
				: [],
		(album) => plural(album.trackCount, "track"),
	),
];

// Needs no history, no ratings and no play counts, so a library Jean knows nothing about still opens on something to press.
const STARTER = shelf(
	"starter",
	"Start somewhere",
	"A few records out of your library",
	shuffled,
	(album) => plural(album.trackCount, "track"),
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

	// Nothing qualified: a new install, or a player with no playback statistics at all.
	return [fill(STARTER, albums)].filter((entry) => entry !== null);
}

// Ascending, which is not the order the shelf is drawn in: beefweb's `add-from-library` ignores the order of `items` and adds them in the library's own, so a position computed against shelf order would address a different track.
export function refsOfShelf(shelf: FilledShelf<Album>) {
	return Int32Array.from(
		shelf.albums.flatMap((album) => [...album.refs]),
	).sort();
}
