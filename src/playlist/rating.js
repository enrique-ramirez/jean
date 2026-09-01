import { FIELD, number } from './fields.js'

export const MAX_STARS = 5

// POPM's byte, on the thresholds Windows Explorer, foobar2000 and MediaMonkey
// share. They are not even fifths: they are centred on the values Windows Media
// Player actually writes -- 1, 64, 128, 196, 255 -- which is why the bands are
// lopsided. The even-fifths mapping quoted around the web (1-51, 52-102, ...)
// disagrees with this one only at values no major tagger writes, so the choice
// costs nothing either way; this one is what the players do.
const POPM_FLOORS = [224, 160, 96, 32, 1]

const popmStars = (raw) => MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor)

// A rating tag is a bare number with no declared scale, and at least four
// conventions are in circulation. *Measured* over one real 30,441-track
// library, every rating on it: 375 tracks at `5`, 39 at `100`, 40 at `-1` and
// 27 at `0`, 14 at `2.5` and 3 at `3.5` -- MP3, FLAC, Vorbis, AAC and WMA, four
// taggers' habits in one folder tree. Reading only 0-5 would have called 39 of
// those unrated, which is not "Jean cannot tell", it is Jean ignoring a rating
// that is plainly there.
//
// So the magnitude picks the scale, because the magnitude is the only evidence
// there is:
//
//   <= 0        unrated. `0` and `-1` are two taggers' spellings of "no rating"
//               and neither is a bad review
//   <= 5        foobar2000's native scale, halves and all
//   <= 10       the 0-10 scale; foo_playcount stores ratings up to 10
//   <= 100      the 0-100 scale FLAC's RATING has converged on, 20 to a star
//   <= 255      a POPM byte written out as text
//
// Two boundaries are genuinely ambiguous and cannot be resolved from the value:
// `5` is five stars on the native scale and half marks on a 0-10 one, and `10`
// is full marks on 0-10 and one twentieth of a 0-100 one. Both go to the more
// common convention, which is the lower scale. Detecting a library-wide scale
// instead does not help and is worse -- the library measured above holds `5`
// and `100` at the same time, so there is no one answer for it, and picking one
// would misread 375 tracks to rescue 39.
//
// Anything above 255 is not a rating in any convention, so it is not read as
// one. *Not* clamped to five stars: a number that large means the field is
// being used for something else, and inventing full marks out of it would be
// the loudest possible way to be wrong.
export function starsOf(raw) {
  if (raw === null || raw <= 0) return null
  if (raw <= MAX_STARS) return raw
  if (raw <= 10) return raw / 2
  if (raw <= 100) return (raw / 100) * MAX_STARS
  if (raw <= 255) return popmStars(raw)
  return null
}

export const ratingOf = (row) => starsOf(number(row, FIELD.rating))

// Halves are kept rather than rounded away: a file that says 3.5 says 3.5, and
// Jean displaying 4 would be Jean disagreeing with the player about what the
// library contains. Rounding to the nearest *half* is only so a rescaled value
// has a star to land on -- 90 out of 100 is four and a half, and 85 is close
// enough to the same thing that drawing it as 4.25 of a star would be reporting
// a precision the tag does not have.
export const toStars = (rating) => Math.round(rating * 2) / 2

// Whether this library has any rating Jean can read. Scanned in full rather
// than sampled, which the other capability probes are not: ratings are *sparse*
// -- 500 tracks in 30,441, 1.6% -- so a 200-row sample misses them outright
// about one library in twenty-five, and the failure is silent both ways. One
// pass of an array index over 30k rows is well under a millisecond, once.
export function hasAnyRating(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    if (ratingOf(rows[index]) !== null) return true
  }
  return false
}

// Whether the library uses half stars at all. Nothing reads it yet; it is what
// a future rating control has to ask before deciding whether its own increment
// is 1 or 0.5, because introducing halves into a library that has none is a
// change to the user's tags they did not ask for. Sampled, unlike the above:
// getting this wrong picks a default, not whether a column exists.
export function hasHalfStars(rows, sampleSize = 400) {
  const step = Math.max(1, Math.floor(rows.length / sampleSize))
  for (let index = 0; index < rows.length; index += step) {
    const rating = ratingOf(rows[index])
    if (rating !== null && rating % 1 !== 0) return true
  }
  return false
}
