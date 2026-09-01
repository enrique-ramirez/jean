import { percentile } from './albums.js'

const LIMIT = 24
const YEAR = 365.25 * 24 * 60 * 60 * 1000

// A shelf is a filter over the albums, a title, and a sentence it can say about
// each entry. That last part is the whole point: "437 albums matching a
// predicate" is a query result, and "you played this 32 times a track and not
// since 2016" is a reason to press play. A shelf that cannot say why an album is
// on it probably should not exist.
//
// Every threshold is a percentile of the library rather than a number, so these
// fill on a library of three thousand plays and one of three. A shelf that
// cannot fill simply does not render -- there is no empty shelf state, because
// an empty shelf is not information.
const shelf = (id, title, blurb, pick, caption) => ({ id, title, blurb, pick, caption })

const byPlays = (a, b) => b.plays - a.plays
const byRecent = (a, b) => b.lastPlayed - a.lastPlayed
const yearsSince = (at) => (Date.now() - at) / YEAR

const said = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export const SHELVES = [
  shelf(
    'recent',
    'Recently played',
    'Where you have been lately',
    (albums) => albums.filter((a) => a.lastPlayed > 0).sort(byRecent),
    (a) => `Last played ${new Date(a.lastPlayed).getFullYear()}`,
  ),

  shelf(
    'top',
    'Most played',
    'The records you keep coming back to',
    (albums) => albums.filter((a) => a.plays > 0).sort(byPlays),
    (a) => said(Math.round(a.plays), 'play', 'plays'),
  ),

  // The emotional centre of the screen, and the reason the caption matters.
  // Loved hard, then dropped: top-quartile plays per track, bottom-quartile
  // recency. Measured on a 30,441-track library it lands on 31 albums.
  shelf(
    'loved',
    'You used to love this',
    'Played to death, then forgotten',
    (albums) => {
      const played = albums.filter((a) => a.plays > 0 && a.lastPlayed > 0 && a.trackCount >= 4)
      if (played.length < 8) return []
      const busy = percentile(played.map((a) => a.playsPerTrack), 0.75)
      const stale = percentile(played.map((a) => a.lastPlayed), 0.25)
      return played
        .filter((a) => a.playsPerTrack >= busy && a.lastPlayed <= stale)
        .sort((a, b) => b.playsPerTrack - a.playsPerTrack)
    },
    // Terse on purpose: the caption sits under a 160px cover, and "43 plays a
    // track, last heard 2016" ellipsised away the year -- which is the half
    // that makes it a story rather than a statistic.
    (a) => `${Math.round(a.playsPerTrack)}x a track, ${new Date(a.lastPlayed).getFullYear()}`,
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
        .sort((a, b) => b.playsPerTrack - a.playsPerTrack)
    },
    (a) => `${Math.round(a.bitrate)} kbps, ${Math.round(a.playsPerTrack)}x a track`,
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
    (albums) => albums.filter((a) => a.plays === 0).sort((a, b) => b.trackCount - a.trackCount),
    (a) => said(a.trackCount, 'track', 'tracks'),
  ),
]

// Built once per library, then handed to the rows. A shelf yielding fewer than
// four albums is dropped rather than shown thin: a row of two covers reads as
// something failing to load.
const MINIMUM = 4

export function buildShelves(albums) {
  if (albums.length === 0) return []

  const built = []
  for (const entry of SHELVES) {
    const picked = entry.pick(albums)
    if (picked.length < MINIMUM) continue
    built.push({ ...entry, albums: picked.slice(0, LIMIT), total: picked.length })
  }
  return built
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
