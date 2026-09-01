import type { TrackColumns } from "../api/types";
import { FIELD, number, sampleRows } from "./fields";

export const MAX_STARS = 5;

// POPM's byte, on the thresholds Windows Explorer, foobar2000 and MediaMonkey
// share. Lopsided rather than even fifths, because they are centred on the
// values Windows Media Player actually writes.
const POPM_FLOORS = [224, 160, 96, 32, 1];

const popmStars = (raw: number) =>
	MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor);

// A rating tag is a bare number with no declared scale, so the magnitude picks
// the scale -- it is the only evidence there is. At least four conventions are
// in circulation and one folder tree can hold several at once, so reading only
// 0-5 is not "Jean cannot tell", it is Jean ignoring a rating plainly there.
// Detecting one scale per library is worse rather than better, for the same
// reason. `5` and `10` are genuinely ambiguous between two scales and both go
// to the lower, more common one.
//
// Above 255 is not a rating in any convention, so it is not read as one and
// specifically **not clamped to five stars**: a number that large means the
// field is being used for something else, and inventing full marks out of it is
// the loudest possible way to be wrong.
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

// Halves are kept rather than rounded away: a file that says 3.5 says 3.5, and
// showing 4 would be Jean disagreeing with the player about what the library
// contains. Rounding to the nearest half is only so a rescaled value has a star
// to land on -- 85 out of 100 drawn as 4.25 of a star would report a precision
// the tag does not have.
export const toStars = (rating: number) => Math.round(rating * 2) / 2;

// Whether this library has any rating Jean can read. Scanned in full rather
// than sampled, unlike every other capability probe: ratings are sparse enough
// that a sample misses them outright on a good few libraries, silently, and one
// array index per row is cheap enough to pay once.
export const hasAnyRating = (rows: TrackColumns[]) =>
	rows.some((row) => ratingOf(row) !== null);

// Whether the library uses half stars. Nothing reads it yet; it is what a
// future rating control has to ask before choosing an increment of 1 or 0.5,
// because introducing halves into a library that has none is a change to
// somebody's tags they did not ask for. Sampled, because getting this wrong
// picks a default rather than whether a column exists.
export const hasHalfStars = (rows: TrackColumns[], sampleSize = 400) =>
	sampleRows(rows, sampleSize).some((row) => {
		const rating = ratingOf(row);
		return rating !== null && rating % 1 !== 0;
	});
