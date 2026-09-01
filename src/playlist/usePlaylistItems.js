import { useCallback, useEffect, useSyncExternalStore } from 'react'

import {
  EMPTY_PLAYLIST,
  libraryKey,
  loadLibrary,
  loadPlaylist,
  playlistKey,
  playlistSnapshot,
  subscribePlaylist,
} from './playlistStore.js'

const stayUnsubscribed = () => () => {}

// A window onto one load in the store: rows, progress and the derived heat and
// patina. The work happens once in there, however many components look at it.
function useLoadedRows(key, start) {
  useEffect(() => {
    if (key) start()
  }, [key, start])

  return useSyncExternalStore(
    useCallback((listener) => (key ? subscribePlaylist(key, listener) : stayUnsubscribed()), [key]),
    useCallback(() => (key ? playlistSnapshot(key) : EMPTY_PLAYLIST), [key]),
  )
}

export function usePlaylistItems(playlistId, itemCount) {
  const isReady = Boolean(playlistId) && itemCount != null

  return useLoadedRows(
    isReady ? playlistKey(playlistId, itemCount) : null,
    useCallback(() => loadPlaylist(playlistId, itemCount), [playlistId, itemCount]),
  )
}

// The media library, through the same store and the same subscription. Only the
// fetching differs, and that lives in the store.
export function useLibraryItems(itemCount) {
  return useLoadedRows(
    itemCount == null ? null : libraryKey(itemCount),
    useCallback(() => loadLibrary(itemCount), [itemCount]),
  )
}
