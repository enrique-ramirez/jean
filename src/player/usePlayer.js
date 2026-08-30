import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { UPDATES_URL, fetchPlayer, playPause } from '../api/beefweb.js'
import { positionAt } from './position.js'

export const PLAYER_KEY = ['player']

// Player state is pushed, not fetched, so it carries the timestamp it arrived
// at. Keeping the two together makes the interpolation anchor atomic.
const snapshot = (player) => ({ player, syncedAt: performance.now() })

/**
 * Bridges the SSE stream into the query cache.
 *
 * Mount once, at the root. Everything downstream then reads player state through
 * an ordinary useQuery, and mutations get to optimistically write the same key.
 */
export function usePlayerStream() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(UPDATES_URL)

    source.onmessage = (event) => {
      const { player } = JSON.parse(event.data)
      if (player) queryClient.setQueryData(PLAYER_KEY, snapshot(player))
    }

    // EventSource reconnects on its own, and beefweb replays a full snapshot on
    // connect, so a dropped stream heals without any resync logic here.
    return () => source.close()
  }, [queryClient])
}

export function usePlayer() {
  return useQuery({
    queryKey: PLAYER_KEY,
    queryFn: async () => snapshot(await fetchPlayer()),
    // The stream owns this key. The fetch only covers first paint and reconnect.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function usePlayPause() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: playPause,

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: PLAYER_KEY })
      const previous = queryClient.getQueryData(PLAYER_KEY)
      if (!previous?.player) return { previous }

      const { player } = previous
      queryClient.setQueryData(PLAYER_KEY, {
        player: {
          ...player,
          playbackState: player.playbackState === 'playing' ? 'paused' : 'playing',
          // Freeze the *interpolated* position, not the stale one from the last
          // update — otherwise pausing snaps the bar back by however long the
          // track has been running.
          activeItem: { ...player.activeItem, position: positionAt(previous, performance.now()) },
        },
        syncedAt: performance.now(),
      })

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(PLAYER_KEY, context.previous)
    },
  })
}
