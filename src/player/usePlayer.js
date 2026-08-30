import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  UPDATES_URL,
  fetchPlayer,
  fetchPlaylists,
  nextTrack,
  playPause,
  previousTrack,
  seekBy,
  seekTo,
  setMuted,
  setPlaybackOrder,
  setVolume,
  stop,
  volumeDown,
  volumeUp,
} from '../api/beefweb.js'
import { positionAt } from './position.js'

export const PLAYER_KEY = ['player']
export const PLAYLISTS_KEY = ['playlists']

// Player state is pushed, not fetched, so it carries the timestamp it arrived
// at. Keeping the two together makes the interpolation anchor atomic.
const snapshot = (player) => ({ player, syncedAt: performance.now() })

// Bridges the SSE stream into the query cache. Mount once, at the root.
// Everything downstream then reads through an ordinary useQuery, and mutations
// optimistically write the same keys.
export function usePlayerStream() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(UPDATES_URL)

    source.onmessage = (event) => {
      const { player, playlists } = JSON.parse(event.data)
      if (player) queryClient.setQueryData(PLAYER_KEY, snapshot(player))
      if (playlists) queryClient.setQueryData(PLAYLISTS_KEY, playlists)
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

export function usePlaylists() {
  return useQuery({
    queryKey: PLAYLISTS_KEY,
    queryFn: fetchPlaylists,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

// The track the player is on, only when it belongs to the playlist being viewed.
export function useActiveItem(playlistId) {
  const { data } = usePlayer()
  const item = data?.player?.activeItem
  if (!item || item.index < 0 || item.playlistId !== playlistId) return null
  return item
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
          // Freeze the interpolated position, not the stale one from the last
          // update -- otherwise pausing snaps the bar back by however long the
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

export function useSeek() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: seekTo,

    onMutate: async (position) => {
      await queryClient.cancelQueries({ queryKey: PLAYER_KEY })
      const previous = queryClient.getQueryData(PLAYER_KEY)
      if (!previous?.player?.activeItem) return { previous }

      queryClient.setQueryData(PLAYER_KEY, {
        player: {
          ...previous.player,
          activeItem: { ...previous.player.activeItem, position },
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

export function useSeekBy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: seekBy,

    onMutate: async (offset) => {
      await queryClient.cancelQueries({ queryKey: PLAYER_KEY })
      const previous = queryClient.getQueryData(PLAYER_KEY)
      const item = previous?.player?.activeItem
      if (!item) return { previous }

      // Offset from the interpolated position, not the last pushed one, or a
      // seek lands wherever the track happened to be at the last update.
      const next = Math.min(
        Math.max(positionAt(previous, performance.now()) + offset, 0),
        item.duration ?? 0,
      )

      queryClient.setQueryData(PLAYER_KEY, {
        player: { ...previous.player, activeItem: { ...item, position: next } },
        syncedAt: performance.now(),
      })

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(PLAYER_KEY, context.previous)
    },
  })
}

// The order enum differs between players and versions, so the shuffle entry is
// found by name rather than by a hardcoded index. foobar2000 offers several
// shuffle flavours; tracks is the one people mean by "shuffle".
function findShuffleIndex(names) {
  const lower = names.map((name) => name.toLowerCase())
  const exact = lower.indexOf('shuffle (tracks)')
  if (exact >= 0) return exact

  const anyShuffle = lower.findIndex((name) => name.includes('shuffle'))
  if (anyShuffle >= 0) return anyShuffle

  return lower.findIndex((name) => name.includes('random'))
}

// Playback order is global player state, not a property of the playlist being
// viewed, and toggling it must not disturb what is currently playing -- it only
// changes what comes next.
export function usePlaybackOrder() {
  const { data } = usePlayer()
  const queryClient = useQueryClient()

  const player = data?.player
  const option = player?.options?.find((entry) => entry.id === 'playbackOrder')
  const names = option?.enumNames ?? player?.playbackModes ?? []
  const value = option?.value ?? player?.playbackMode ?? 0

  const shuffleIndex = useMemo(() => findShuffleIndex(names), [names])
  const isShuffle = shuffleIndex >= 0 && value === shuffleIndex

  // Turning shuffle off returns you to the order you had, not to Default, so a
  // repeat setting survives a shuffle detour. Session-scoped: after a reload the
  // best guess is the first mode.
  const previousOrder = useRef(0)
  if (!isShuffle && value !== previousOrder.current) previousOrder.current = value

  const mutation = useMutation({
    mutationFn: setPlaybackOrder,

    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: PLAYER_KEY })
      const previous = queryClient.getQueryData(PLAYER_KEY)
      if (!previous?.player) return { previous }

      queryClient.setQueryData(PLAYER_KEY, {
        ...previous,
        player: {
          ...previous.player,
          playbackMode: next,
          options: previous.player.options?.map((entry) =>
            entry.id === 'playbackOrder' ? { ...entry, value: next } : entry,
          ),
        },
      })

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(PLAYER_KEY, context.previous)
    },
  })

  const toggleShuffle = useCallback(() => {
    if (shuffleIndex < 0) return
    mutation.mutate(isShuffle ? previousOrder.current : shuffleIndex)
  }, [isShuffle, shuffleIndex, mutation])

  return {
    isShuffle,
    canShuffle: shuffleIndex >= 0,
    orderName: names[value] ?? null,
    toggleShuffle,
  }
}

// Volume changes are written optimistically: the slider has to track the
// pointer, and waiting for the stream to echo each step would make it lag.
function usePlayerPatch(mutationFn, patch) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: PLAYER_KEY })
      const previous = queryClient.getQueryData(PLAYER_KEY)
      if (!previous?.player?.volume) return { previous }

      queryClient.setQueryData(PLAYER_KEY, {
        ...previous,
        player: { ...previous.player, volume: patch(previous.player.volume, input) },
      })

      return { previous }
    },

    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(PLAYER_KEY, context.previous)
    },
  })
}

export function useVolume() {
  const { data } = usePlayer()

  const set = usePlayerPatch(setVolume, (volume, value) => ({ ...volume, value }))
  const mute = usePlayerPatch(setMuted, (volume, isMuted) => ({ ...volume, isMuted }))
  const nudgeUp = useMutation({ mutationFn: volumeUp })
  const nudgeDown = useMutation({ mutationFn: volumeDown })

  return {
    volume: data?.player?.volume ?? null,
    setValue: set.mutate,
    setMuted: mute.mutate,
    up: nudgeUp.mutate,
    down: nudgeDown.mutate,
  }
}

export function useTransport() {
  return {
    next: useMutation({ mutationFn: nextTrack }),
    previous: useMutation({ mutationFn: previousTrack }),
    stop: useMutation({ mutationFn: stop }),
  }
}
