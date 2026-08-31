import { useCallback, useEffect, useSyncExternalStore } from 'react'

import {
  EMPTY_PLAYLIST,
  libraryKey,
  loadLibrary,
  playlistSnapshot,
  subscribePlaylist,
} from '../playlist/playlistStore.js'

const stayUnsubscribed = () => {}

// The media library, loaded through the same store the playlist view uses --
// same subscription, same heat and patina, same one-load-shared rule. Only the
// fetching differs, and that lives in the store.
export function useLibraryItems(itemCount) {
  const key = itemCount != null ? libraryKey(itemCount) : null

  useEffect(() => {
    if (itemCount != null) loadLibrary(itemCount)
  }, [itemCount])

  return useSyncExternalStore(
    useCallback((listener) => (key ? subscribePlaylist(key, listener) : stayUnsubscribed), [key]),
    useCallback(() => (key ? playlistSnapshot(key) : EMPTY_PLAYLIST), [key]),
  )
}
