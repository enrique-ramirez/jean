import { FIELD, sameTagValue, value } from './fields.js'

// The tag is free text and rippers disagree about it: '1', '01' and '1/2' all
// turn up, the last of them writing the total into the same field. Only the
// leading number is the disc, and anything that is not a positive number at all
// is no disc rather than disc zero.
export function discNumber(row) {
  const raw = value(row, FIELD.discNumber)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// Groups contiguous runs only -- it never reorders. A playlist sorted by album
// yields clean blocks; a shuffled one yields many small ones, which is honest
// about what the playlist actually is. Reordering here would desync the view
// from playback, since the player decides what comes next.
//
// Membership is compared loosely: one stray capital mid-album would otherwise
// split it into two groups with two covers. The group still displays the first
// row's spelling rather than a normalised one.
//
// Discs are runs within a run, on the same terms: a two-disc album is one album
// with two blocks of tracks, not two albums, so it keeps one cover and one
// caption and the split is drawn inside it.
export function groupByAlbum(rows) {
  const groups = []
  let current = null
  let disc = null

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
        discs: [],
      }
      groups.push(current)
      disc = null
    }

    const number = discNumber(row)
    if (disc && disc.number === number) {
      disc.count += 1
    } else {
      disc = { number, start: index, count: 1 }
      current.discs.push(disc)
    }
  }

  // `discs` is null unless it says something. A single run is the ordinary
  // album and wants no headings at all, and a run where any disc is untagged
  // would put a heading over one half of an album and nothing over the other --
  // which reads as a bug rather than as missing metadata.
  for (const group of groups) {
    if (group.discs.length < 2 || group.discs.some((entry) => entry.number === null)) {
      group.discs = null
    }
  }

  return groups
}

// One byte per row: is this row part of an album that spans more than one disc?
// The list layout draws no album header to hang a disc heading from, so there
// the disc travels with the track number instead -- and only where there is
// more than one disc to tell apart, or every number in the library grows a '1.'
// that distinguishes nothing.
export function multiDiscRows(groups, length) {
  const flags = new Uint8Array(length)
  for (const group of groups) {
    if (group.discs) flags.fill(1, group.start, group.start + group.count)
  }
  return flags
}
