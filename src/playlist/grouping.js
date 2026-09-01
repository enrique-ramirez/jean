import { FIELD, sameTagValue, value } from './fields.js'

// The tag is free text and rippers disagree about it: '1', '01' and '1/2' all
// turn up, the last writing the total into the same field. Only the leading
// number is the disc, and anything that is not a positive number is no disc
// rather than disc zero.
export function discNumber(row) {
  const raw = value(row, FIELD.discNumber)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// `discs` is null unless it says something. A single run is the ordinary album
// and wants no headings, and a run where any disc is untagged would put a
// heading over one half of an album and nothing over the other -- which reads
// as a bug rather than as missing metadata.
const discsWorthDrawing = (discs) =>
  discs.length >= 2 && discs.every((disc) => disc.number !== null) ? discs : null

// Groups contiguous runs only -- it never reorders. A playlist sorted by album
// yields clean blocks; a shuffled one yields many small ones, which is honest
// about what the playlist is. Reordering here would desync the view from
// playback, since the player decides what comes next.
//
// Membership is compared loosely, or one stray capital mid-album splits it into
// two groups with two covers; the group still shows the first row's spelling.
// Discs are runs within a run, on the same terms: a two-disc album is one album
// with two blocks of tracks, so it keeps one cover and one caption.
export function groupByAlbum(rows) {
  const groups = rows.reduce((built, row, index) => {
    const album = value(row, FIELD.album) ?? 'Unknown album'
    const albumArtist = value(row, FIELD.albumArtist) ?? value(row, FIELD.artist) ?? 'Unknown artist'
    const number = discNumber(row)

    const open = built[built.length - 1]
    const continues =
      open && sameTagValue(open.album, album) && sameTagValue(open.albumArtist, albumArtist)

    if (!continues) {
      built.push({
        key: `${albumArtist} ${album} ${index}`,
        album,
        albumArtist,
        year: value(row, FIELD.year),
        start: index,
        count: 1,
        discs: [{ number, start: index, count: 1 }],
      })
      return built
    }

    open.count += 1
    const disc = open.discs[open.discs.length - 1]
    if (disc.number === number) disc.count += 1
    else open.discs.push({ number, start: index, count: 1 })

    return built
  }, [])

  return groups.map((group) => ({ ...group, discs: discsWorthDrawing(group.discs) }))
}

// Which row's cover every row wears -- its album run's first row, so a record's
// worth of rows share one URL and therefore one request.
//
// Artwork is addressed per row and not per album (a playlist by index, the media
// library by path), so a record's tracks are one URL each for one picture and
// the browser cannot know they are the same. There is no way to ask for a
// thumbnail either -- the full image comes back whatever size it is drawn at --
// so the request count is the only thing there is to reduce.
//
// That an album has one cover is not a new assumption -- the album layout has
// always drawn exactly one -- but it was checked against real compilations
// rather than asserted.
export function albumCoverRows(groups, length) {
  const cover = new Int32Array(length)
  groups.forEach((group) => cover.fill(group.start, group.start, group.start + group.count))
  return cover
}

// One byte per row: is this row part of an album spanning more than one disc?
// The list layout draws no album header to hang a disc heading from, so there
// the disc travels with the track number -- and only where there is more than
// one to tell apart, or every number in the library grows a '1.' that
// distinguishes nothing.
export function multiDiscRows(groups, length) {
  const flags = new Uint8Array(length)
  groups.forEach((group) => {
    if (group.discs) flags.fill(1, group.start, group.start + group.count)
  })
  return flags
}
