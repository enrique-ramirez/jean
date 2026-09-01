import { percentile } from './albums.js'
import { describeWhen, yearOf } from './when.js'

const LIMIT = 24
const YEAR = 365.25 * 24 * 60 * 60 * 1000

// A shelf is a filter over the albums, a title, and a sentence it can say about
// each entry. That last part is the whole point: "437 albums matching a
// predicate" is a query result, and "you played this 32 times a track and not
// since 2016" is a reason to press play. A shelf that cannot say why an album is
// on it probably should not exist.
//
// Two rules keep them honest on somebody else's library.
//
// **Thresholds are percentiles**, so a shelf fills whether you have three plays
// a track or three hundred. But a percentile only promises that *something*
// qualifies, never that the title is true -- measured on a library played daily,
// the bottom quartile of recency was still last year, so "played to death, then
// forgotten" was offering records last heard months ago. Where a shelf makes a
// claim about time it carries an absolute floor as well.
//
// **A shelf that cannot fill honestly does not render.** No empty states and no
// thin rows: a library with no ratings has no starred shelf, and one too new to
// have forgotten anything has no forgotten shelf.
const shelf = (id, title, blurb, pick, caption) => ({ id, title, blurb, pick, caption })

const byPlays = (a, b) => b.plays - a.plays
const byRecent = (a, b) => b.lastPlayed - a.lastPlayed

const said = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const plays = (n) => said(Math.round(n), 'play', 'plays')

export const SHELVES = [
  shelf(
    'recent',
    'Recently played',
    'Where you have been lately',
    (albums) => albums.filter((a) => a.lastPlayed > 0).sort(byRecent),
    (a) => describeWhen(a.lastPlayed),
  ),

  shelf(
    'top',
    'Most played',
    'The records you keep coming back to',
    (albums) => albums.filter((a) => a.plays > 0).sort(byPlays),
    (a) => plays(a.plays),
  ),

  // Loved hard, then dropped. Selected on plays *per track*, because a long
  // soundtrack would otherwise win on volume alone -- but captioned with the
  // album's total, because "1,300 plays" is a thing anyone can read and "43x a
  // track" turned out not to be.
  shelf(
    'loved',
    'You used to love this',
    'Played to death, then put down',
    (albums) => {
      const played = albums.filter((a) => a.plays > 0 && a.lastPlayed > 0 && a.trackCount >= 4)
      if (played.length < 8) return []
      const busy = percentile(played.map((a) => a.playsPerTrack), 0.75)
      // The floor is what makes the title true. Without it this shelf offers
      // records from last year and calls them forgotten.
      const silent = Date.now() - 1.5 * YEAR
      return played
        .filter((a) => a.playsPerTrack >= busy && a.lastPlayed <= silent)
        .sort(byPlays)
    },
    // Just the surprising half. The shelf's title already says you loved it, so
    // repeating the play count in the chip only cost the year to an ellipsis on
    // a phone -- and the year is the part that stings.
    (a) => `Not since ${yearOf(a.lastPlayed)}`,
  ),

  // Nothing else does this, and it costs nothing: %codec% and %bitrate% are
  // already fetched for every row. An album you play constantly and only own as
  // a bad rip is a thing you would want to know about.
  shelf(
    'upgrade',
    'Worth a better copy',
    'You play these a lot, and they are low bitrate',
    (albums) => {
      const lossy = albums.filter((a) => !a.lossless && a.bitrate && a.plays > 0 && a.trackCount >= 4)
      if (lossy.length < 8) return []
      const busy = percentile(lossy.map((a) => a.playsPerTrack), 0.75)
      const poor = percentile(lossy.map((a) => a.bitrate), 0.25)
      return lossy
        .filter((a) => a.playsPerTrack >= busy && a.bitrate <= poor)
        .sort(byPlays)
    },
    (a) => `${Math.round(a.bitrate)} kbps, ${plays(a.plays)}`,
  ),

  // Ratings are sparse and lopsided -- *measured*, 375 of one library's 500 are
  // the same value -- so sorting by average alone is sorting a flat tie. The
  // second key is how many tracks on the record you actually starred, which is
  // the difference between "you liked a song on this" and "you went through it".
  shelf(
    'rated',
    'You starred these',
    'Albums you marked up yourself',
    (albums) => {
      const rated = albums.filter((a) => a.ratedCount >= 2)
      if (rated.length < 8) return []
      const good = percentile(rated.map((a) => a.rating), 0.5)
      return rated
        .filter((a) => a.rating >= good)
        .sort((a, b) => b.rating - a.rating || b.ratedCount - a.ratedCount)
    },
    (a) => `${a.rating.toFixed(1)} stars, ${a.ratedCount} rated`,
  ),

  shelf(
    'unopened',
    'Never opened',
    'In your library, never played',
    (albums) => {
      // "Never played" is a claim about your listening, and on a player with no
      // playback-statistics component every album reads as zero -- so the shelf
      // would offer the entire library and call all of it untouched. That is
      // absence of *data* wearing the clothes of absence of *plays*. If nothing
      // anywhere has been played, Jean does not know, and says nothing.
      if (!albums.some((a) => a.plays > 0)) return []
      return albums.filter((a) => a.plays === 0).sort((a, b) => b.trackCount - a.trackCount)
    },
    (a) => said(a.trackCount, 'track', 'tracks'),
  ),
]

// Built once per library, then handed to the rows. A shelf yielding fewer than
// four albums is dropped rather than shown thin: a row of two covers reads as
// something failing to load.
const MINIMUM = 4

// The one shelf that needs no history, no ratings and no play counts: records
// drawn at random. It exists so a library Jean knows nothing about yet still
// opens on something to press rather than on an apology.
const STARTER = shelf(
  'starter',
  'Start somewhere',
  'A few records out of your library',
  (albums) => {
    const picked = [...albums]
    for (let at = 0; at < Math.min(LIMIT, picked.length); at += 1) {
      const swap = at + Math.floor(Math.random() * (picked.length - at))
      const held = picked[at]
      picked[at] = picked[swap]
      picked[swap] = held
    }
    return picked
  },
  (a) => said(a.trackCount, 'track', 'tracks'),
)

export function buildShelves(albums) {
  if (albums.length === 0) return []

  const built = []
  for (const entry of SHELVES) {
    const picked = entry.pick(albums)
    if (picked.length < MINIMUM) continue
    built.push({ ...entry, albums: picked.slice(0, LIMIT), total: picked.length })
  }

  if (built.length > 0) return built

  // Nothing qualified -- a brand new install, or a player with no playback
  // statistics at all. One row of the library beats an empty screen.
  const starter = STARTER.pick(albums)
  if (starter.length < MINIMUM) return []
  return [{ ...STARTER, albums: starter.slice(0, LIMIT), total: starter.length }]
}

// Every track on a shelf, **ascending**, which is not the order the shelf is
// drawn in and has to be said out loud.
//
// *Measured against the live player*: `add-from-library` ignores the order of
// `items` and adds them in the library's own order. Asking for library offsets
// 0, 20000, 10000, 30000 returned 0, 10000, 20000, 30000. So a set concatenated
// in shelf order -- most played first -- arrives sorted, and every position
// computed against the shelf order then addresses a different track. Clicking
// an album on "Never opened" played something else entirely.
//
// Sorting here is what keeps the three orders identical: what the view renders,
// what the playlist holds, and what a position means. Search never hit this
// because its indices are already ascending.
export function refsOfShelf(shelf) {
  let length = 0
  for (const album of shelf.albums) length += album.refs.length

  const refs = new Int32Array(length)
  let at = 0
  for (const album of shelf.albums) {
    refs.set(album.refs, at)
    at += album.refs.length
  }
  return refs.sort()
}
