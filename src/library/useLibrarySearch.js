import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'

import { playlistKey } from '../playlist/playlistStore.js'
import { usePlaylistItems } from '../playlist/usePlaylistItems.js'
import { libraryIndex, searchLibrary } from './libraryIndex.js'
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
  const [query, setQuery] = useState('')
  const [isEngaged, setIsEngaged] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef(null)

  // The library is megabytes and most sessions never search, so nothing is
  // fetched until someone actually reaches for the field.
  const isWanted = isEngaged || query.length > 0
  const library = usePlaylistItems(
    isWanted ? playlist?.id : null,
    isWanted ? playlist?.itemCount : null,
  )

  // Typing stays responsive while the filter runs over 30k rows behind it.
  const deferredQuery = useDeferredValue(query)
  const key = playlist ? playlistKey(playlist.id, playlist.itemCount) : null

  const matched = useMemo(
    () => (key && library.rows.length > 0 ? searchLibrary(libraryIndex(key, library.rows), deferredQuery) : null),
    [key, library.rows, deferredQuery],
  )

  const results = useMemo(
    () => project(library.rows, matched, library.heat, library.patina),
    [library.rows, matched, library.heat, library.patina],
  )

  const focus = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return {
    playlist,
    choose,
    query,
    setQuery,
    clear: useCallback(() => setQuery(''), []),
    inputRef,
    focus,
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
