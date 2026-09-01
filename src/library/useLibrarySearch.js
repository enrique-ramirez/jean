import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { removePlaylist } from '../api/beefweb.js'
import { usePermissions, usePlayer } from '../player/usePlayer.js'
import { libraryIndex, searchLibrary } from './libraryIndex.js'
import { isScratchPlaylist, queryOfScratchPlaylist } from './jeanPlaylists.js'
import { EMPTY_VIEW, project } from './project.js'

// One view over the library, and a very specific one: text the user typed. It
// owns the query and nothing else -- the rows, the source and the loading all
// belong to `useLibrary`, because every other view filters the same array.
//
// Owned by the shell so it survives navigating away to a playlist and back.
export function useLibrarySearch(library, playlists) {
  const permissions = usePermissions()
  const { data: playerSnapshot } = usePlayer()
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef(null)

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

  const restore = useCallback(() => {
    setQuery((current) => current || remembered || '')
  }, [remembered])

  // Dismissing the search takes the playlist with it: it exists to be played,
  // and nobody asked for a leftover named after a search they closed.
  //
  // Except while the player is on it. Deleting the playing playlist does not end
  // playback at the end of the track: the player falls back to another playlist
  // and carries on, which is exactly the wandering out of the results this
  // arrangement exists to stop. So it outlives the search for as long as it is
  // being listened to, and the next set played from takes it over.
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

  const { request } = library

  // A query is an ask, whether it was typed or taken back off the player after
  // a reload. Without this a restored search comes back with its heading, its
  // field and no rows at all, because nothing ever told the library it was
  // needed -- focus is the other ask, and a reload does not focus anything.
  useEffect(() => {
    if (query.length > 0) request()
  }, [query, request])

  // Typing stays responsive while the filter runs over 30k rows behind it.
  const deferredQuery = useDeferredValue(query)

  const matched = useMemo(
    () =>
      library.key && library.rows.length > 0
        ? searchLibrary(libraryIndex(library.key, library.rows), deferredQuery)
        : null,
    [library.key, library.rows, deferredQuery],
  )

  const results = useMemo(
    () => project(library, matched),
    [library, matched],
  )

  const focus = useCallback(() => {
    request()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [request])

  return {
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
      request()
    }, [request]),
    onBlur: useCallback(() => setIsFocused(false), []),
    hasQuery: query.trim().length > 0,
    // The rendered results can lag the field by a frame or two; that is the
    // deferred value doing its job, and it is worth saying so in the UI.
    isFiltering: query !== deferredQuery,
    results: results ?? EMPTY_VIEW,
    matchCount: matched?.length ?? 0,
    // Distinct per query, which is what makes each result set its own view:
    // its own remembered scroll offset, cursor and row measurements.
    viewKey: `search:${deferredQuery.trim().toLowerCase()}`,
  }
}
