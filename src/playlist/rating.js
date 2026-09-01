import { FIELD, number } from './fields.js'

export const MAX_STARS = 5

// The rating tag is not one scale, and no amount of wishing makes it one.
// *Measured* on a real 30,441-track library: 375 tracks at `5`, 39 at `100`,
// 40 at `-1` and 27 at `0` used as "unrated" sentinels, and 17 carrying half
// stars. Jean reads (0, 5] and treats everything else as no rating at all --
// rescaling 100 into stars would be Jean inventing a number the file does not
// carry, and 0 and -1 are absences rather than bad reviews. Per-value scale
// guessing cannot work anyway: on a library holding both scales at once, `5`
// is five stars under one reading and one star under the other, and nothing in
// the tag says which. Tag hygiene is the library owner's business.
export function ratingOf(row) {
  const rating = number(row, FIELD.rating)
  return rating !== null && rating > 0 && rating <= MAX_STARS ? rating : null
}

// Halves are kept rather than rounded away: a file that says 3.5 says 3.5, and
// Jean displaying 4 would be Jean disagreeing with the player about what the
// library contains. Rounding to the nearest *half* is only so an arbitrary
// decimal has a star to land on -- it never turns a half into a whole.
export const toStars = (rating) => Math.round(rating * 2) / 2

// Whether this library uses half stars at all, sampled the same way
// `fieldIsAvailable` samples. Nothing reads it yet; it is what a future rating
// control has to ask before deciding whether its own increment is 1 or 0.5,
// because introducing halves into a library that has none is a change to the
// user's tags that they did not ask for.
export function hasHalfStars(rows, sampleSize = 400) {
  const step = Math.max(1, Math.floor(rows.length / sampleSize))
  for (let index = 0; index < rows.length; index += step) {
    const rating = ratingOf(rows[index])
    if (rating !== null && rating % 1 !== 0) return true
  }
  return false
}
