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

// Which row's cover every row wears. The album layout draws one cover per group
// already -- `AlbumGroup` asks for `group.start`'s -- and this is the same
// answer shaped for a list, where every row draws its own.
//
// It exists because artwork is addressed per row and not per album: a playlist
// by index, the media library by path. So twelve tracks off one record are
// twelve URLs for one picture, and the browser cannot know they are the same.
// *Measured* against the live player, the first twelve rows of the library:
// twelve requests, the same ETag on all of them, 633 KB each -- 7.6 MB fetched
// to draw one cover twelve times at 34px.
//
// Pointing them all at the run's first row makes it one URL, which the browser
// then coalesces on its own. Across 35 sampled albums that took 462 requests
// down to 35, and 328 MB to 24 MB.
//
// The assumption is that an album has one cover, and it is not a new one: the
// album layout has always drawn exactly one, so this makes the two layouts
// agree rather than introducing a claim. It was checked anyway, because it is
// the kind of thing that is true in one library and false in the next -- 35
// random albums and then the 14 most compilation-shaped ones on the player,
// Various Artists collections with fifteen different track artists in them.
// Every track of every one of them returned the same ETag.
export function albumCoverRows(groups, length) {
  const cover = new Int32Array(length)
  for (const group of groups) cover.fill(group.start, group.start, group.start + group.count)
  return cover
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
