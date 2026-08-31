import { useCallback, useEffect, useSyncExternalStore } from 'react'

import {
  EMPTY_PLAYLIST,
  loadPlaylist,
  playlistKey,
  playlistSnapshot,
  subscribePlaylist,
} from './playlistStore.js'

const stayUnsubscribed = () => {}

// Rows, load progress and the derived heat/patina arrays for one playlist. The
// work happens once in the store; this is only a window onto it.
export function usePlaylistItems(playlistId, itemCount) {
  const key = playlistId && itemCount != null ? playlistKey(playlistId, itemCount) : null

  useEffect(() => {
    if (playlistId && itemCount != null) loadPlaylist(playlistId, itemCount)
  }, [playlistId, itemCount])

  return useSyncExternalStore(
    useCallback((listener) => (key ? subscribePlaylist(key, listener) : stayUnsubscribed), [key]),
    useCallback(() => (key ? playlistSnapshot(key) : EMPTY_PLAYLIST), [key]),
  )
}
