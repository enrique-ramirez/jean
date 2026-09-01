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

// Generic in the album, so a shelf built from covered albums still says so
// downstream: the picks only filter and sort.
export interface FilledShelf<A extends Album = Album> extends Shelf {
	albums: A[];
	total: number;
}

// The filters already guarantee these, but the aggregate type cannot say so.
type WithBitrate = Album & { bitrate: number };
type WithRating = Album & { rating: number };

const LIMIT = 24;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// A shelf yielding fewer than this is dropped rather than shown thin: a row of
// two covers reads as something failing to load.
const MINIMUM = 4;

// A filter over the albums, a title, and a sentence it can say about each entry.
// That last part is the point: "437 albums matching a predicate" is a query
// result, "32 plays a track and not since 2016" is a reason to press play.
//
// Thresholds are percentiles, so a shelf fills whether you have three plays a
// track or three hundred -- but a percentile only promises something qualifies,
// never that the title is true, so a shelf claiming something about time carries
// an absolute floor too. A shelf that cannot fill honestly does not render.
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

// Decorate, sort, undecorate. `sort(() => Math.random() - 0.5)` is biased: the
// result depends on the comparison order the engine happens to use.
const shuffled = <T>(items: T[]): T[] =>
	items
		.map((item) => ({ item, at: Math.random() }))
		.sort((a, b) => a.at - b.at)
		.map(({ item }) => item);

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

	// Plays *per track*, or a long soundtrack wins on volume alone -- but captioned
	// with the year, which is the part that stings.
	shelf(
		"loved",
		"You used to love this",
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
			// The floor is what makes the title true. Without it this shelf offers
			// records from last year and calls them forgotten.
			const silent = Date.now() - 1.5 * YEAR_MS;

			return played
				.filter(
					(album) => album.playsPerTrack >= busy && album.lastPlayed <= silent,
				)
				.sort(byPlays);
		},
		(album) => `Not since ${yearOf(album.lastPlayed)}`,
	),

	// Costs nothing: %codec% and %bitrate% are already fetched for every row. An
	// album you play constantly and only own as a bad rip is worth knowing about.
	shelf(
		"upgrade",
		"Worth a better copy",
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

	// Ratings are sparse and lopsided, so sorting by average alone sorts a flat tie.
	// The second key is how many tracks were actually starred.
	shelf(
		"rated",
		"You starred these",
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

	shelf(
		"unopened",
		"Never opened",
		"In your library, never played",
		(albums) =>
			// With no playback-statistics component every album reads as zero, so this would
			// offer the whole library and call it untouched.
			albums.some((album) => album.plays > 0)
				? albums
						.filter((album) => album.plays === 0)
						.sort((a, b) => b.trackCount - a.trackCount)
				: [],
		(album) => plural(album.trackCount, "track"),
	),
];

// Needs no history, no ratings and no play counts, so a library Jean knows
// nothing about still opens on something to press rather than an apology.
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

	// Nothing qualified -- a brand new install, or a player with no playback
	// statistics at all. One row of the library beats an empty screen.
	return [fill(STARTER, albums)].filter((entry) => entry !== null);
}

// Ascending, which is not the order the shelf is drawn in and has to be said out
// loud: `add-from-library` ignores the order of `items` and adds them in the
// library's own, so a set concatenated in shelf order arrives sorted and every
// position computed against it addresses a different track.
export function refsOfShelf(shelf: FilledShelf<Album>) {
	return Int32Array.from(
		shelf.albums.flatMap((album) => [...album.refs]),
	).sort();
}
