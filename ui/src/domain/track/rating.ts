import type { TrackColumns } from "@/shared/api/types";
import { FIELD, numberOf, readNumber } from "./fields";

export const MAX_STARS = 5;

const POPM_FLOORS = [224, 160, 96, 32, 1];

const popmStars = (raw: number) =>
	MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor);

export function starsOf(raw: number | null): number | null {
	if (raw === null || raw <= 0) return null; // `0` and `-1` are two spellings of "unrated"
	if (raw <= MAX_STARS) return raw; // foobar2000's native scale, halves and all
	if (raw <= 10) return raw / 2; // the 0-10 scale foo_playcount writes
	if (raw <= 100) return (raw / 100) * MAX_STARS; // the 0-100 scale FLAC's RATING converged on
	if (raw <= 255) return popmStars(raw); // a POPM byte written out as text
	return null;
}

export const rawRatingOf = (row: TrackColumns) => numberOf(row, FIELD.rating);

export const rawRatingOfValue = readNumber;

export const rawRatingWith = (
	row: TrackColumns,
	written: string | undefined,
) => (written === undefined ? rawRatingOf(row) : rawRatingOfValue(written));

export const ratingOf = (row: TrackColumns) => starsOf(rawRatingOf(row));

// Narrower than what can be read: only foobar2000's native 0-5 is written back, so a value on any
// other scale is left alone rather than rescaled. Unrated declares no scale, so it is writable.
export const isWritableScale = (raw: number | null) =>
	raw === null || raw <= MAX_STARS;

export const toStars = (rating: number) => Math.round(rating * 2) / 2;
