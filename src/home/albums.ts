import type { TrackColumns } from "../api/types";
import { FIELD, number, timestamp, value } from "../playlist/fields";
import type { PlaylistSnapshot } from "../playlist/playlistStore";
import { ratingOf } from "../playlist/rating";

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "APE", "WAVPACK", "TAK"]);

const keyOf = (artist: string, album: string) =>
	`${artist} ${album}`.toLowerCase().replace(/\s+/g, " ");

const blankAlbum = (key: string, row: TrackColumns) => ({
	key,
	album: value(row, FIELD.album),
	artist:
		value(row, FIELD.albumArtist) ??
		value(row, FIELD.artist) ??
		"Unknown artist",
	refs: [] as number[],
	plays: 0,
	lastPlayed: 0,
	bitrateTotal: 0,
	bitrateCount: 0,
	lossless: true,
	ratings: [] as number[],
});

type AlbumDraft = ReturnType<typeof blankAlbum>;

const absorb = (album: AlbumDraft, ref: number, row: TrackColumns) => {
	album.refs.push(ref);

	album.plays += number(row, FIELD.playCount) ?? 0;

	const played = timestamp(row, FIELD.lastPlayed);
	if (played !== null && played > album.lastPlayed) album.lastPlayed = played;

	const bitrate = number(row, FIELD.bitrate);
	if (bitrate) {
		album.bitrateTotal += bitrate;
		album.bitrateCount += 1;
	}

	const codec = value(row, FIELD.codec);
	if (codec && !LOSSLESS.has(codec.toUpperCase())) album.lossless = false;

	// What counts as a rating is decided in one place -- see playlist/rating.js.
	// Averaged unrounded: the display rounds to the nearest half star, but a
	// shelf comparing albums wants the real numbers.
	const rating = ratingOf(row);
	if (rating !== null) album.ratings.push(rating);

	return album;
};

const summed = (album: AlbumDraft) => ({
	...album,
	refs: Int32Array.from(album.refs),
	trackCount: album.refs.length,
	playsPerTrack: album.refs.length > 0 ? album.plays / album.refs.length : 0,
	bitrate:
		album.bitrateCount > 0 ? album.bitrateTotal / album.bitrateCount : null,
	ratedCount: album.ratings.length,
	rating:
		album.ratings.length > 0
			? album.ratings.reduce((total, one) => total + one, 0) /
				album.ratings.length
			: null,
});

// Inferred rather than declared, so the shape cannot drift from what `summed`
// actually builds. `bitrate` and `rating` are null on an album the player could
// not answer for -- a shelf that leans on either narrows first.
export type Album = ReturnType<typeof summed>;

// An album with the cover its source addresses it by. `albumsOf` cannot know
// that -- it walks rows, and where artwork lives is the source's business -- so
// the home screen attaches it once and the shelves carry it through.
export interface CoveredAlbum extends Album {
	artworkUrl: string;
}

// Albums across the whole library, which is a different question from
// `groupByAlbum`. That one groups *contiguous runs*, because a playlist's order
// is the player's business. A shelf has no such constraint: it picks albums out
// of the library wherever they sit, so the same record split across two places
// in path order is one album here.
//
// One pass with a mutable accumulator: this walks every row in the library.
export function albumsOf(library: PlaylistSnapshot): Album[] {
	const byKey = library.rows.reduce((into, row, ref) => {
		const album = value(row, FIELD.album);
		if (!album) return into;

		const artist =
			value(row, FIELD.albumArtist) ??
			value(row, FIELD.artist) ??
			"Unknown artist";
		const key = keyOf(artist, album);

		into.set(key, absorb(into.get(key) ?? blankAlbum(key, row), ref, row));
		return into;
	}, new Map<string, AlbumDraft>());

	return [...byKey.values()].map(summed);
}

// Thresholds are percentiles of *this* library, never constants. A library
// whose busiest album has three plays still has a top quartile; hardcode a
// number and the shelf is empty on every library but the one it was written
// against.
export function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = Float64Array.from(values).sort();
	const at = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round((sorted.length - 1) * fraction)),
	);
	return sorted[at];
}
