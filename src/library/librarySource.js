import {
  addFromLibrary,
  artworkUrl,
  copyPlaylistItems,
  libraryArtworkUrl,
  libraryPathMatcher,
  removePlaylistItems,
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

const fillByLibrary = (paths, subsongs) => (targetId, refs) =>
  addFromLibrary(targetId, {
    items: itemsFor(paths, subsongs, refs),
    // One request, so there is no count to read first, no range to remove, and
    // no window where the playlist holds half of two result sets. That window
    // is what made a click on one row play a different track.
    replace: true,
  })

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
