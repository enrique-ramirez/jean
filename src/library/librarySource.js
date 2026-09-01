import {
  LIBRARY_SORT,
  addFromLibrary,
  artworkUrl,
  copyPlaylistItems,
  libraryArtworkUrl,
  libraryPathMatcher,
  removePlaylistItems,
  sortPlaylistItems,
} from '../api/beefweb.js'
import { positionOf } from './libraryIndex.js'

// Where "the library" comes from, behind one interface, because there are two
// answers and both have to keep working.
//
//   - **The media library API** (beefweb 0.11+, foobar2000 only). Tracks are
//     addressed by `(path, subsong)`, artwork needs no playlist, and filling a
//     playlist with a set of them is a single request.
//   - **An autoplaylist** the user made, which is every released beefweb and
//     every DeaDBeeF. Tracks are addressed by their index in that playlist.
//
// The seam is a **numeric ref per row**, not a shape. Both sources produce one
// -- the playlist source's ref is the playlist index, the library source's is a
// position in its own `paths` array -- so `indices`, `useTrackSelection`, the
// search index and the whole virtualised list stay integer-keyed and never
// learn which source they are looking at. Only the things that *act* on a row
// need to know, and they are the methods below.
//
// If something outside this file has to ask which source it is, the seam is in
// the wrong place.

// Playback needs a playlist either way -- there is no "play this library item",
// only "put it in a playlist and start there". So both sources fill the scratch
// playlist and the caller plays a position in it. What differs is what filling
// costs, and whether it can be got wrong.
// Array.from, never refs.map: refs arrive as an Int32Array from the search
// index, and mapping a typed array gives back a typed array -- the objects are
// coerced to NaN and JSON.stringify then sends `{"0":0,...}` rather than a
// list. copyPlaylistItems guards the same way for the same reason.
const itemsFor = (paths, subsongs, refs) =>
  Array.from(refs, (ref) => ({ path: paths[ref], subsong: subsongs[ref] }))

// The player does not add a set in the order it was asked for. It adds it in
// the media library's own browse order -- album artist, album, track -- and
// that is not the order `/library/items` hands back, which is file path.
// *Measured* on a 30,441-track library: of 100 tracks sent in path order, 10
// landed somewhere else; of 1,000, 426 did; of 8,000, 3,945 did. Every view
// here plays by position, so every one of those is a click on one row playing a
// different track. It survived this long because the fake preserves the order
// it is given, so nothing in the suite could see it.
//
// The order cannot be predicted and it cannot be read: no `sort` expression
// reproduces it -- `%album artist%` matches 9 positions out of 30,441 -- and
// learning it once by reading the filled playlist back costs 3.2 MB and 680 ms
// here, ~21 MB at 200k, with nothing to invalidate it against, because the
// player publishes no library-change event at all (`library` is not a valid
// `/api/query` key).
//
// So do not predict it. Overwrite it: fill however is cheapest, then sort the
// playlist by the same expression the library was read with. Verified against
// the live player at 100, 1,000, 4,000 and all 30,441 tracks -- every position
// correct, every time, for ~340 ms of server-side work and no client state.
const sortToLibraryOrder = (targetId) => sortPlaylistItems(targetId, LIBRARY_SORT)

// beefweb closes the connection on a request body over 1 MiB. *Measured*:
// 1,018,757 bytes accepted, 1,049,652 rejected mid-upload -- so naming all
// 30,441 tracks, which is a 2.9 MB body, never reached the player at all. That
// is the whole of "All music will not play": `fill` threw, and the play that
// was waiting on it never happened.
//
// Well under it, because the cost is per *item* rather than per request anyway
// -- the player resolves each path against the library at ~1.2 ms a track, so
// there is nothing to win by going wide.
const MAX_BODY_BYTES = 768 * 1024

const chunkedItems = (items) => {
  const chunks = []
  let chunk = []
  let bytes = 0

  for (const item of items) {
    const size = JSON.stringify(item).length + 1
    if (bytes + size > MAX_BODY_BYTES && chunk.length > 0) {
      chunks.push(chunk)
      chunk = []
      bytes = 0
    }
    chunk.push(item)
    bytes += size
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

const fillByLibrary = (paths, subsongs) => async (targetId, refs) => {
  // Every view here is built from distinct library positions, so covering the
  // count is covering the library. Naming all of them costs 2.9 MB and ~36
  // seconds of path resolution; asking for the library by omitting `items`
  // costs one request with no body and 299 ms, and the sort below makes the two
  // indistinguishable afterwards.
  if (refs.length === paths.length) {
    await addFromLibrary(targetId, { replace: true })
    return sortToLibraryOrder(targetId)
  }

  const chunks = chunkedItems(itemsFor(paths, subsongs, refs))
  // Sequential, and it has to be: only the first may replace, and the rest
  // append to what it left. Concurrency would race over which one lands first
  // and the replace could arrive last, emptying the playlist it was filling.
  for (let at = 0; at < chunks.length; at += 1) {
    await addFromLibrary(targetId, { items: chunks[at], replace: at === 0 })
  }
  return sortToLibraryOrder(targetId)
}

const fillByCopy = (sourceId) => async (targetId, refs, heldCount) => {
  // The count comes from the caller, who has to have read it from the player:
  // item changes are never pushed, so a cached itemCount is stale from the
  // first write onwards and this range would be wrong.
  if (heldCount > 0) {
    await removePlaylistItems(targetId, Array.from({ length: heldCount }, (_, at) => at))
  }
  return copyPlaylistItems(sourceId, targetId, refs)
}

export function librarySourceOf({ kind, playlistId, paths, subsongs }) {
  if (kind === 'library') {
    return {
      kind,
      // There is no playlist behind this one. Anything that needs a playlist to
      // act goes through the methods rather than reaching for an id.
      playlistId: null,
      needsHeldCount: false,

      artworkUrl: (ref) => libraryArtworkUrl(paths[ref], subsongs[ref]),
      fill: fillByLibrary(paths, subsongs),
      // No sort here, unlike `fill`. That playlist is the user's, its order is
      // theirs, and re-sorting it to suit Jean would be Jean rearranging
      // somebody's music because of how it happened to add to it. Undo is
      // unaffected either way -- it takes off the range that was appended, not
      // particular rows.
      addTo: (targetId, refs) =>
        addFromLibrary(targetId, { items: itemsFor(paths, subsongs, refs) }),

      // `(path, subsong)` is a real identity, which playlist items do not have,
      // so the playing row is found from whichever playlist the player happens
      // to be inside -- including one Jean is not looking at.
      //
      // Linear, where the playlist source bisects, because path order is not ref
      // order. Paid once per track change rather than per player message, and
      // the matcher normalises the player's path once for the whole sweep.
      playingPosition: (refs, track) => {
        if (!track?.path) return -1
        const matches = libraryPathMatcher(track.path)
        const subsong = track.subsong ?? 0

        for (let position = 0; position < refs.length; position += 1) {
          const ref = refs[position]
          if (subsongs[ref] === subsong && matches(paths[ref])) return position
        }
        return -1
      },
    }
  }

  return {
    kind: 'playlist',
    playlistId,
    // The caller has to hand `fill` the target's live item count, because
    // emptying it is a remove-by-range and the range has to be right.
    needsHeldCount: true,

    artworkUrl: (ref) => artworkUrl(playlistId, ref),
    fill: fillByCopy(playlistId),
    addTo: (targetId, refs) => copyPlaylistItems(playlistId, targetId, refs),

    // Index is identity here, so this can only answer while the player is
    // inside the very playlist being browsed. The same file playing from
    // somewhere else is invisible, which is the limitation the library source
    // does not have.
    //
    // A bisection rather than a scan: refs arrive ascending, and this is the
    // fallback that runs on players where the library is a 30,000-row
    // autoplaylist.
    playingPosition: (refs, track, activeItem) =>
      activeItem?.playlistId === playlistId ? positionOf(refs, activeItem.index) : -1,
  }
}
