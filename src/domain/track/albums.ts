import type { TrackColumns } from "@/shared/api/types";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import {
	coverKey,
	FIELD,
	lastPlayedOf,
	numberOf,
	playCountOf,
	tagKey,
	value,
} from "./fields";
import { growingIndex } from "./growingIndex";
import { ratingOf } from "./rating";

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "APE", "WAVPACK", "TAK"]);

// The raw tag, never a display fallback: `coverIdentity` folds a missing artist to nothing, so
// standing in `Unknown artist` here would give the same record two identities.
const keyOf = (artist: string | null | undefined, album: string) =>
	coverKey(artist, album);

// Whoever the record is by, as the files have it. Both tags, since `%album artist%` is missing far
// more often than `%artist%` is.
const artistTagOf = (row: TrackColumns) =>
	value(row, FIELD.albumArtist) ?? value(row, FIELD.artist);

const blankAlbum = (
	key: string,
	album: string,
	artist: string | null,
	// Built once with the album rather than when the list is derived, since deriving happens again
	// every time a chunk of library arrives and squashing every title each time is the expensive half.
	match: FuzzyKey,
) => ({
	key,
	album,
	match,
	// The tag as it stands, which is the other half of the album's identity; `artist` is what to draw.
	artistTag: artist,
	artist: artist ?? "Unknown artist",
	refs: [] as number[],
	plays: 0,
	lastPlayed: 0,
	bitrateTotal: 0,
	bitrateCount: 0,
	year: null as number | null,
	lossless: true,
	ratings: [] as number[],
});

type AlbumDraft = ReturnType<typeof blankAlbum>;

const absorb = (album: AlbumDraft, ref: number, row: TrackColumns) => {
	album.refs.push(ref);

	album.plays += playCountOf(row) ?? 0;

	const played = lastPlayedOf(row);
	if (played !== null && played > album.lastPlayed) album.lastPlayed = played;

	// The earliest of them: a reissue often tags its own release year onto one or two tracks.
	const year = numberOf(row, FIELD.year);
	if (
		year !== null &&
		year > 1000 &&
		(album.year === null || year < album.year)
	)
		album.year = year;

	const bitrate = numberOf(row, FIELD.bitrate);
	if (bitrate) {
		album.bitrateTotal += bitrate;
		album.bitrateCount += 1;
	}

	const codec = value(row, FIELD.codec);
	if (codec && !LOSSLESS.has(codec.toUpperCase())) album.lossless = false;

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

export type Album = ReturnType<typeof summed>;

export interface CoveredAlbum extends Album {
	artworkUrl: string;
}

function collect(
	byKey: Map<string, AlbumDraft>,
	rows: TrackColumns[],
	from: number,
) {
	for (let ref = from; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const album = value(row, FIELD.album);
		if (!album) continue;

		const artist = artistTagOf(row);
		const key = keyOf(artist, album);

		byKey.set(
			key,
			absorb(
				byKey.get(key) ?? blankAlbum(key, album, artist, fuzzyKey(album)),
				ref,
				row,
			),
		);
	}
}

const derive = (byKey: Map<string, AlbumDraft>): Album[] =>
	[...byKey.values()].map(summed);

export function albumsOf(rows: TrackColumns[]): Album[] {
	const byKey = new Map<string, AlbumDraft>();
	collect(byKey, rows, 0);
	return derive(byKey);
}

export const albumIndex = growingIndex(collect, derive);

export interface AlbumTracks {
	refs: Int32Array;
	// As the files spell them. The route carries the halves normalised, and a page may not draw those.
	album: string;
	artist: string | null;
}

/**
 * One record's rows. It takes two tags to name one: `Blood, Sweat & Tears` is an album by two
 * different bands, and a title on its own would collect both. Matched through the key `albumsOf`
 * groups by, so a count beside a title and the page behind it can never be different sets.
 */
export function refsOfAlbum(
	rows: TrackColumns[],
	artist: string | null | undefined,
	album: string,
): AlbumTracks {
	const wanted = keyOf(artist, album);
	// An empty title would match every untagged row rather than nothing.
	if (!tagKey(album)) return { refs: new Int32Array(0), album, artist: null };

	const refs: number[] = [];
	let spelling: { album: string; artist: string | null } | null = null;

	for (let ref = 0; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const title = value(row, FIELD.album);
		if (!title) continue;

		const artistTag = artistTagOf(row);
		if (keyOf(artistTag, title) !== wanted) continue;

		spelling ??= { album: title, artist: artistTag };
		refs.push(ref);
	}

	return {
		refs: Int32Array.from(refs),
		...(spelling ?? { album, artist: null }),
	};
}

export function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = Float64Array.from(values).sort();
	const at = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round((sorted.length - 1) * fraction)),
	);
	return sorted[at];
}
