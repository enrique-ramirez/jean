import type { TrackColumns } from "@/shared/api/types";
import { FIELD, number, sampleRows } from "./fields";

export const MAX_STARS = 5;

// POPM's byte, on the thresholds Windows Explorer, foobar2000 and MediaMonkey
// share. Lopsided rather than even fifths, because they are centred on the
// values Windows Media Player actually writes.
const POPM_FLOORS = [224, 160, 96, 32, 1];

const popmStars = (raw: number) =>
	MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor);

// A bare number with no declared scale, so the magnitude picks it -- the only
// evidence there is. At least four conventions are in circulation and one folder
// tree can hold several, so reading only 0-5 is not "Jean cannot tell", it is
// Jean ignoring a rating plainly there. `5` and `10` are genuinely ambiguous and
// both go to the lower, more common scale.
//
// Above 255 is not a rating in any convention, so it is not read as one and
// specifically not clamped to five stars: inventing full marks out of a field
// being used for something else is the loudest way to be wrong.
function starsOf(raw: number | null): number | null {
	if (raw === null || raw <= 0) return null; // `0` and `-1` are two spellings of "unrated"
	if (raw <= MAX_STARS) return raw; // foobar2000's native scale, halves and all
	if (raw <= 10) return raw / 2; // the 0-10 scale foo_playcount writes
	if (raw <= 100) return (raw / 100) * MAX_STARS; // the 0-100 scale FLAC's RATING converged on
	if (raw <= 255) return popmStars(raw); // a POPM byte written out as text
	return null;
}

export const ratingOf = (row: TrackColumns) =>
	starsOf(number(row, FIELD.rating));

// A file that says 3.5 says 3.5; showing 4 would be Jean disagreeing with the
// player. Rounding to the nearest half is only so a rescaled value has a star to
// land on.
export const toStars = (rating: number) => Math.round(rating * 2) / 2;

// Scanned in full rather than sampled, unlike every other capability probe:
// ratings are sparse enough that a sample misses them outright on a good few
// libraries, silently.
export const hasAnyRating = (rows: TrackColumns[]) =>
	rows.some((row) => ratingOf(row) !== null);

// What a future rating control has to ask before choosing an increment of 1 or
// 0.5: introducing halves into a library that has none is a change to somebody's
// tags they did not ask for.
export const hasHalfStars = (rows: TrackColumns[], sampleSize = 400) =>
	sampleRows(rows, sampleSize).some((row) => {
		const rating = ratingOf(row);
		return rating !== null && rating % 1 !== 0;
	});
