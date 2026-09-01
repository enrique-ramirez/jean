import { plural } from '../ui/text.js'
import { FIELD, number, value } from './fields.js'

const TOP_GENRES = 4
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Compare loosely, display exactly. `Rock` and `rock` are one genre, and a
// portrait that reports them as two is measuring the tagging rather than the
// music -- but the chip still shows the first file's own spelling.
//
// A genre is whatever the tag says, taken whole: foobar joins multiple values
// with '; ', so `Rock; Pop` counts as itself rather than as two, because Jean
// does not get to decide that somebody's tag is really two tags.
const genreKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim()

// What any set of tracks adds up to, from the rows already in memory. One
// implementation for a playlist header, a set of results and the front door, so
// the same library cannot be described two ways two centimetres apart.
//
// One pass with a mutable accumulator rather than one pass per figure: this
// runs over the whole library, again for every chunk that lands.
export function summarise(rows, playedCount = 0) {
  const totals = rows.reduce(
    (into, row) => {
      into.seconds += number(row, FIELD.duration) ?? 0

      const year = number(row, FIELD.year)
      if (year !== null && year > 1000) {
        into.earliest = into.earliest === null ? year : Math.min(into.earliest, year)
        into.latest = into.latest === null ? year : Math.max(into.latest, year)
      }

      const genre = value(row, FIELD.genre)
      if (genre) {
        const seen = into.genres.get(genreKey(genre))
        if (seen) seen.count += 1
        else into.genres.set(genreKey(genre), { name: genre, count: 1 })
      }

      return into
    },
    { seconds: 0, earliest: null, latest: null, genres: new Map() },
  )

  return {
    trackCount: rows.length,
    seconds: totals.seconds,
    earliest: totals.earliest,
    latest: totals.latest,
    genreCount: totals.genres.size,
    topGenres: [...totals.genres.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_GENRES)
      .map(({ name, count }) => ({ name, share: Math.round((count / rows.length) * 100) })),
    playedShare: rows.length > 0 ? playedCount / rows.length : 0,
  }
}

const breakDown = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? {
        days: Math.floor(seconds / DAY),
        hours: Math.floor((seconds % DAY) / HOUR),
        minutes: Math.floor((seconds % HOUR) / MINUTE),
      }
    : null

// Human units, biggest first, never more than two. A count of seconds is a
// number about a computer; "84 days 14 hr" is a number about a life. Days
// rather than months, because a month is not a fixed length and nobody can
// picture "2.8 months of music".
//
// Two spellings of the same figure: the headline on the home screen says it in
// full because it is a sentence, and a view header abbreviates because it is
// sitting in a row of other facts.
export function spellDuration(seconds) {
  const parts = breakDown(seconds)
  if (!parts) return null

  const { days, hours, minutes } = parts
  if (days > 0) return { lead: plural(days, 'day'), trail: hours > 0 ? `${hours} hr` : null }
  if (hours > 0) return { lead: plural(hours, 'hour'), trail: minutes > 0 ? `${minutes} min` : null }
  return { lead: plural(minutes, 'minute'), trail: null }
}

export function formatDuration(seconds) {
  const parts = breakDown(seconds)
  if (!parts) return null

  const { days, hours, minutes } = parts
  if (days > 0) return `${plural(days, 'day')} ${hours} hr`
  if (hours > 0) return `${hours} hr ${minutes} min`
  return `${minutes} min`
}
