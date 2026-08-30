import { FIELD, sameTagValue, value } from './fields.js'

// Groups contiguous runs only -- it never reorders. A playlist sorted by album
// yields clean blocks; a shuffled one yields many small ones, which is honest
// about what the playlist actually is. Reordering here would desync the view
// from playback, since the player decides what comes next.
//
// Membership is compared loosely: one stray capital mid-album would otherwise
// split it into two groups with two covers. The group still displays the first
// row's spelling rather than a normalised one.
export function groupByAlbum(rows) {
  const groups = []
  let current = null

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const album = value(row, FIELD.album) ?? 'Unknown album'
    const albumArtist = value(row, FIELD.albumArtist) ?? value(row, FIELD.artist) ?? 'Unknown artist'

    const continues =
      current && sameTagValue(current.album, album) && sameTagValue(current.albumArtist, albumArtist)

    if (continues) {
      current.count += 1
    } else {
      current = {
        key: `${albumArtist} ${album} ${index}`,
        album,
        albumArtist,
        year: value(row, FIELD.year),
        start: index,
        count: 1,
      }
      groups.push(current)
    }
  }

  return groups
}
