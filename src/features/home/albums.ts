import {
	FIELD,
	lastPlayedOf,
	numberOf,
	playCountOf,
	tagKey,
	value,
} from "@/domain/track/fields";
import { ratingOf } from "@/domain/track/rating";
import type { TrackColumns } from "@/shared/api/types";

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "APE", "WAVPACK", "TAK"]);

const keyOf = (artist: string, album: string) => tagKey(`${artist} ${album}`);

const blankAlbum = (key: string, album: string, row: TrackColumns) => ({
	key,
	album,
	artist:
		value(row, FIELD.albumArtist) ??
		value(row, FIELD.artist) ??
		"Unknown artist",
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

export function albumsOf(rows: TrackColumns[]): Album[] {
	const byKey = rows.reduce((into, row, ref) => {
		const album = value(row, FIELD.album);
		if (!album) return into;

		const artist =
			value(row, FIELD.albumArtist) ??
			value(row, FIELD.artist) ??
			"Unknown artist";
		const key = keyOf(artist, album);

		into.set(
			key,
			absorb(into.get(key) ?? blankAlbum(key, album, row), ref, row),
		);
		return into;
	}, new Map<string, AlbumDraft>());

	return [...byKey.values()].map(summed);
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
