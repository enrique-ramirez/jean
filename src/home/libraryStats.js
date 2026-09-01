import { FIELD, number, value } from '../playlist/fields.js'
import { withoutJeanPlaylists } from '../library/jeanPlaylists.js'

const TOP_GENRES = 4

// Loosely, because these are counts rather than labels. `5 Seconds Of Summer`
// and `5 Seconds of Summer` are one artist, and a portrait of a library that
// reports them as two is measuring the tagging rather than the music. The
// spelling shown anywhere is still the file's own -- compare loosely, display
// exactly, the same rule `sameTagValue` exists for.
const norm = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim()

// Everything the header states, in one pass over the rows plus the albums the
// shelves already aggregated. Measured at 30,441 rows: ~4 ms, once per library.
//
// A genre here is whatever the tag says, taken whole. foobar joins multiple
// values with '; ', so `Rock; Pop` counts as its own genre rather than as two
// -- which is what the genre chips have always shown, and Jean does not get to
// decide that somebody's tag is really two tags. See "Tag hygiene is the
// library owner's business".
export function libraryStats({ rows, albums, playlists }) {
  let seconds = 0
  let earliest = null
  let latest = null
  const genres = new Map()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]

    seconds += number(row, FIELD.duration) ?? 0

    const year = number(row, FIELD.year)
    if (year !== null && year > 1000) {
      if (earliest === null || year < earliest) earliest = year
      if (latest === null || year > latest) latest = year
    }

    const genre = value(row, FIELD.genre)
    if (genre) {
      const key = norm(genre)
      const seen = genres.get(key)
      // The first spelling met is the one shown, so the chips keep a real tag
      // off a real file rather than a lowercased reconstruction of one.
      if (seen) seen.count += 1
      else genres.set(key, { name: genre, count: 1 })
    }
  }

  const artists = new Set()
  for (const album of albums) artists.add(norm(album.artist))

  const ranked = [...genres.values()].sort((a, b) => b.count - a.count)

  return {
    trackCount: rows.length,
    albumCount: albums.length,
    artistCount: artists.size,
    genreCount: genres.size,
    // Jean's own are not the user's music. `#Jean Library` and the scratch are
    // plumbing, and counting them would make this disagree with the sidebar
    // two centimetres to the left.
    playlistCount: withoutJeanPlaylists(playlists).length,
    seconds,
    earliest,
    latest,
    topGenres: ranked.slice(0, TOP_GENRES).map((genre) => ({
      name: genre.name,
      share: Math.round((genre.count / rows.length) * 100),
    })),
  }
}

// Human units, biggest first, and never more than two of them. 7,308,412
// seconds is a number about a computer; "84 days 14 hr" is a number about a
// life. Days rather than months or years, because a month is not a fixed
// length and nobody can picture "2.8 months of music" anyway.
export function spellDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const said = (count, unit) => `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'}`

  if (days > 0) return { lead: said(days, 'day'), trail: hours > 0 ? `${hours} hr` : null }
  if (hours > 0) return { lead: said(hours, 'hour'), trail: minutes > 0 ? `${minutes} min` : null }
  return { lead: said(minutes, 'minute'), trail: null }
}
