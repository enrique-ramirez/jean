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
// answers and both have to keep working:
//
//   - **the media library API** (beefweb 0.11+, foobar2000), where a track is
//     addressed by `(path, subsong)` and artwork needs no playlist;
//   - **an autoplaylist** the user made, which is every released beefweb and
//     every DeaDBeeF, where a track is its index in that playlist.
//
// The seam is a **numeric ref per row**, not a shape, so `indices`,
// `useTrackSelection`, the search index and the whole virtualised list stay
// integer-keyed and never learn which source they are looking at. Only the
// things that *act* on a row need to know, and they are the methods below.
//
// If something outside this file has to ask which source it is, the seam is in
// the wrong place.

// Array.from, never refs.map: refs arrive as an Int32Array from the search
// index, and mapping a typed array gives back a typed array -- the objects are
// coerced to NaN and JSON.stringify sends `{"0":0,...}` rather than a list.
const itemsFor = (paths, subsongs, refs) =>
  Array.from(refs, (ref) => ({ path: paths[ref], subsong: subsongs[ref] }))

// The player does not add a set in the order it was asked for. It adds it in
// the media library's own browse order -- album artist, album, track -- which
// is not the file-path order `/library/items` hands back. Every view here plays
// by *position*, so each track that lands somewhere else is a click on one row
// playing another.
//
// That order cannot be predicted (no `sort` expression reproduces it) and
// cannot be cached (the player publishes no library-change event to invalidate
// against). So it is overwritten rather than learned: fill however is cheapest,
// then sort by the same expression the library was read with.
const sortToLibraryOrder = (targetId) => sortPlaylistItems(targetId, LIBRARY_SORT)

// beefweb hangs up on a request body over 1 MiB, and it arrives as a network
// error rather than a status -- so naming a whole library never reached the
// player at all. That was the whole of "All music will not play": `fill` threw
// and the play waiting on it never happened. Well under the cap, because the
// cost is per *item* anyway and there is nothing to win by going wide.
const MAX_BODY_BYTES = 768 * 1024

const chunkedItems = (items) =>
  items.reduce((chunks, item) => {
    const open = chunks[chunks.length - 1]
    const size = JSON.stringify(item).length + 1

    if (!open || open.bytes + size > MAX_BODY_BYTES) chunks.push({ items: [item], bytes: size })
    else {
      open.items.push(item)
      open.bytes += size
    }

    return chunks
  }, [])

const fillByLibrary = (paths, subsongs) => async (targetId, refs) => {
  // Every view here is built from distinct library positions, so covering the
  // count is covering the library -- and omitting `items` means *the whole
  // library*, in one request with no body and no per-track path resolution. The
  // sort below makes the two indistinguishable afterwards.
  if (refs.length === paths.length) {
    await addFromLibrary(targetId, { replace: true })
    return sortToLibraryOrder(targetId)
  }

  // Sequential, and it has to be: only the first may replace, and the rest
  // append to what it left. Run concurrently, the replace could arrive last and
  // empty the playlist it was filling.
  await chunkedItems(itemsFor(paths, subsongs, refs)).reduce(
    (done, chunk, at) =>
      done.then(() => addFromLibrary(targetId, { items: chunk.items, replace: at === 0 })),
    Promise.resolve(),
  )

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

const fromMediaLibrary = ({ paths, subsongs }) => ({
  kind: 'library',
  // There is no playlist behind this one. Anything needing a playlist to act
  // goes through the methods rather than reaching for an id.
  playlistId: null,
  needsHeldCount: false,

  artworkUrl: (ref) => libraryArtworkUrl(paths[ref], subsongs[ref]),
  fill: fillByLibrary(paths, subsongs),

  // No sort here, unlike `fill`. That playlist is the user's and its order is
  // theirs; re-sorting it to suit Jean would be rearranging somebody's music as
  // a side effect of adding to it. Undo is unaffected either way -- it takes
  // off the range that was appended, not particular rows.
  addTo: (targetId, refs) => addFromLibrary(targetId, { items: itemsFor(paths, subsongs, refs) }),

  // `(path, subsong)` is a real identity, which playlist items do not have, so
  // the playing row is found from whichever playlist the player happens to be
  // inside -- including one Jean is not looking at.
  //
  // Linear, where the playlist source bisects, because path order is not ref
  // order. Paid once per track change rather than per player message, and the
  // matcher normalises the player's path once for the whole sweep.
  playingPosition: (refs, track) => {
    if (!track?.path) return -1
    const matches = libraryPathMatcher(track.path)
    const subsong = track.subsong ?? 0
    return refs.findIndex((ref) => subsongs[ref] === subsong && matches(paths[ref]))
  },
})

const fromPlaylist = ({ playlistId }) => ({
  kind: 'playlist',
  playlistId,
  // The caller has to hand `fill` the target's live item count, because
  // emptying it is a remove-by-range and the range has to be right.
  needsHeldCount: true,

  artworkUrl: (ref) => artworkUrl(playlistId, ref),
  fill: fillByCopy(playlistId),
  addTo: (targetId, refs) => copyPlaylistItems(playlistId, targetId, refs),

  // Index is identity here, so this can only answer while the player is inside
  // the very playlist being browsed -- the limitation the library source does
  // not have. A bisection rather than a scan: refs arrive ascending, and on
  // these players the library *is* an autoplaylist.
  playingPosition: (refs, track, activeItem) =>
    activeItem?.playlistId === playlistId ? positionOf(refs, activeItem.index) : -1,
})

export const librarySourceOf = (options) =>
  options.kind === 'library' ? fromMediaLibrary(options) : fromPlaylist(options)
