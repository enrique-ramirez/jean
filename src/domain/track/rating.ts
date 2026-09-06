import type { TrackColumns } from "@/shared/api/types";
import { FIELD, numberOf, readNumber, sampleRows } from "./fields";

export const MAX_STARS = 5;

// POPM's byte, on the thresholds Windows Explorer, foobar2000 and MediaMonkey share. Lopsided rather than even fifths, because they centre on the values Windows Media Player writes.
const POPM_FLOORS = [224, 160, 96, 32, 1];

const popmStars = (raw: number) =>
	MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor);

// A bare number with no declared scale, so the magnitude picks it: at least four conventions are in circulation and one folder tree can hold several. `5` and `10` are ambiguous and both go to the lower, more common scale.
// Above 255 is not a rating in any convention, so it is not read as one and specifically not clamped to five stars.
export function starsOf(raw: number | null): number | null {
	if (raw === null || raw <= 0) return null; // `0` and `-1` are two spellings of "unrated"
	if (raw <= MAX_STARS) return raw; // foobar2000's native scale, halves and all
	if (raw <= 10) return raw / 2; // the 0-10 scale foo_playcount writes
	if (raw <= 100) return (raw / 100) * MAX_STARS; // the 0-100 scale FLAC's RATING converged on
	if (raw <= 255) return popmStars(raw); // a POPM byte written out as text
	return null;
}

// The tag before any scale has been guessed at. A write needs this rather than the stars, which look the same whatever convention produced them.
export const rawRatingOf = (row: TrackColumns) => numberOf(row, FIELD.rating);

// The same reading for a value Jean wrote rather than loaded.
export const rawRatingOfValue = readNumber;

// What a row's rating is: a value Jean wrote supersedes the row's own, and both are read on the same scale. Asked from three places, which is three chances to disagree about which wins.
export const rawRatingWith = (
	row: TrackColumns,
	written: string | undefined,
) => (written === undefined ? rawRatingOf(row) : rawRatingOfValue(written));

export const ratingOf = (row: TrackColumns) => starsOf(rawRatingOf(row));

// Narrower than whether it can be read: only foobar2000's native 0-5 is written back, so anything above 5 is on another scale and is left alone. Unrated declares no scale, so it is writable.
export const isWritableScale = (raw: number | null) =>
	raw === null || raw <= MAX_STARS;

// A file that says 3.5 says 3.5; showing 4 would be Jean disagreeing with the player. Rounding to the nearest half is only so a rescaled value has a star to land on.
export const toStars = (rating: number) => Math.round(rating * 2) / 2;

// What a rating control has to ask before choosing an increment of 1 or 0.5: introducing halves into a library that has none changes somebody's tags without being asked.
export const hasHalfStars = (rows: TrackColumns[], sampleSize = 400) =>
	sampleRows(rows, sampleSize).some((row) => {
		const rating = ratingOf(row);
		return rating !== null && rating % 1 !== 0;
	});
