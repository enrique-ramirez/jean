import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'

import { removePlaylist } from '../api/beefweb.js'
import { usePermissions, usePlayer } from '../player/usePlayer.js'
import { libraryKey, playlistKey } from '../playlist/playlistStore.js'
import { usePlaylistItems } from '../playlist/usePlaylistItems.js'
import { libraryIndex, searchLibrary } from './libraryIndex.js'
import { librarySourceOf } from './librarySource.js'
import { useLibraryItems } from './useLibraryItems.js'
import { useLibraryInfo } from './useLibrarySource.js'
import { isScratchPlaylist, queryOfScratchPlaylist } from './scratchPlaylist.js'
import { useLibraryPlaylist } from './useLibraryPlaylist.js'

const NO_RESULTS = { rows: [], indices: new Int32Array(0), heat: new Float32Array(0), patina: new Float32Array(0), playedCount: 0 }

// Search is a view, not a playlist: this projects the matched indices onto the
// arrays the track list already speaks, and nothing is written to the player.
// Heat comes across from the library-wide pass rather than being recomputed
// over the matches, so a track's warmth means the same thing in a result list
// as it does in the library.
function project(rows, matched, heat, patina) {
  if (!matched) return null

  const projected = new Array(matched.length)
  const projectedHeat = new Float32Array(matched.length)
  const projectedPatina = new Float32Array(matched.length)
  let playedCount = 0

  for (let position = 0; position < matched.length; position += 1) {
    const index = matched[position]
    projected[position] = rows[index]
    projectedHeat[position] = heat[index]
    projectedPatina[position] = patina[index]
    if (heat[index] > 0) playedCount += 1
  }

  return { rows: projected, indices: matched, heat: projectedHeat, patina: projectedPatina, playedCount }
}

// One search, owned by the shell so it survives navigating away to a playlist
// and back. The query is the state; everything else falls out of it.
export function useLibrarySearch(playlists) {
  const { playlist, choose } = useLibraryPlaylist(playlists)
  const permissions = usePermissions()
  const { data: playerSnapshot } = usePlayer()
  const [query, setQuery] = useState('')
  const [isEngaged, setIsEngaged] = useState(false)

  // The last search anyone played from, still on the player: the scratch
  // playlist's title is the query that built it. Reading it costs nothing --
  // the playlist list is already here -- and in particular it does not touch
  // the library, so a session that never searches still never loads it.
  //
  // This is what makes a search survive a reload and reach another device. The
  // player is the shared state; Jean does not need one of its own.
  const remembered = useMemo(
    () => queryOfScratchPlaylist(playlists.find(isScratchPlaylist)) || null,
    [playlists],
  )
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef(null)

  const restore = useCallback(() => {
    setQuery((current) => current || remembered || '')
  }, [remembered])

  // Dismissing the search takes the playlist with it: it exists to be played,
  // and nobody asked for a leftover named after a search they closed.
  //
  // Except while the player is on it. Deleting the playing playlist does not
  // end playback at the end of the track -- measured, the player falls back to
  // another playlist and carries on, which is exactly the wandering out of the
  // results that this whole arrangement exists to stop. So it outlives the
  // search only for as long as it is being listened to, and the next search to
  // be played from takes it over.
  const clear = useCallback(() => {
    setQuery('')

    // The active item, not `isCurrent`: that stays pointing at the last
    // playlist played from long after playback stopped, which would have kept
    // the scratch alive forever once it had been used once.
    const playingFrom = playerSnapshot?.player?.activeItem?.playlistId
    const scratch = playlists.find(isScratchPlaylist)
    if (!scratch || scratch.id === playingFrom || permissions.changePlaylists === false) return
    removePlaylist(scratch.id)
  }, [playlists, permissions.changePlaylists, playerSnapshot])

  // The library is megabytes and most sessions never search, so nothing is
  // fetched until someone actually reaches for the field.
  const isWanted = isEngaged || query.length > 0

  // Two places the library can come from. The API when the player has one, the
  // autoplaylist otherwise -- DeaDBeeF, and every beefweb up to 0.10. Both are
  // loaded through the same store and produce the same rows; what differs is
  // how a row is addressed afterwards, which is what `source` carries.
  const { hasLibraryApi, info } = useLibraryInfo()

  // Playing a set of results always needs a playlist to play it in -- there is
  // no "play this library item". So on a player that will not let Jean make
  // one, the media library API can browse but can never play, while the
  // autoplaylist can still be played *in place*. Prefer the one that works.
  const canWrite = permissions.changePlaylists !== false
  const useApi = hasLibraryApi && (canWrite || !playlist)

  const viaApi = useLibraryItems(isWanted && useApi ? info.itemCount : null)
  const viaPlaylist = usePlaylistItems(
    isWanted && !useApi ? playlist?.id : null,
    isWanted && !useApi ? playlist?.itemCount : null,
  )
  const library = useApi ? viaApi : viaPlaylist

  // Typing stays responsive while the filter runs over 30k rows behind it.
  const deferredQuery = useDeferredValue(query)
  // Keyed per source, and carrying the count either way, so an edited library
  // indexes afresh rather than inheriting rows that have moved.
  const key = useApi
    ? libraryKey(info.itemCount)
    : playlist
      ? playlistKey(playlist.id, playlist.itemCount)
      : null

  const matched = useMemo(
    () => (key && library.rows.length > 0 ? searchLibrary(libraryIndex(key, library.rows), deferredQuery) : null),
    [key, library.rows, deferredQuery],
  )

  const results = useMemo(
    () => project(library.rows, matched, library.heat, library.patina),
    [library.rows, matched, library.heat, library.patina],
  )

  // How to act on a row. The list machinery never sees this -- it holds integer
  // refs and nothing else -- but everything that plays, copies or draws artwork
  // goes through it.
  const source = useMemo(
    () =>
      useApi
        ? librarySourceOf({ kind: 'library', paths: library.paths, subsongs: library.subsongs })
        : librarySourceOf({ kind: 'playlist', playlistId: playlist?.id }),
    [useApi, library.paths, library.subsongs, playlist?.id],
  )

  const focus = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return {
    playlist,
    source,
    // The setup screen is for players with no library API. With one, there is
    // nothing to point Jean at and nothing to ask the user for.
    needsSetup: !useApi && !playlist,
    choose,
    query,
    setQuery,
    clear,
    inputRef,
    focus,
    remembered,
    restore,
    // Meta and Ctrl chords still fire inside a text field by design, so the
    // list has to stand down while the field has focus or Mod+A selects thirty
    // thousand rows instead of the word you were fixing.
    isFocused,
    onFocus: useCallback(() => {
      setIsFocused(true)
      setIsEngaged(true)
    }, []),
    onBlur: useCallback(() => setIsFocused(false), []),
    hasQuery: query.trim().length > 0,
    // The rendered results can lag the field by a frame or two; that is the
    // deferred value doing its job, and it is worth saying so in the UI.
    isFiltering: query !== deferredQuery,
    isLoading: library.isLoading,
    loaded: library.loaded,
    total: library.total,
    error: library.error,
    results: results ?? NO_RESULTS,
    matchCount: matched?.length ?? 0,
    // Distinct per query, which is what makes each result set its own view:
    // its own remembered scroll offset, cursor and row measurements.
    viewKey: `search:${deferredQuery.trim().toLowerCase()}`,
  }
}
