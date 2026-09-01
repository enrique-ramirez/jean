import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  UPDATES_URL,
  createPlaylist,
  fetchPlayer,
  fetchPlaylists,
  movePlaylist,
  nextTrack,
  playPause,
  previousTrack,
  removePlaylist,
  renamePlaylist,
  seekBy,
  seekTo,
  setMuted,
  setPlaybackOrder,
  setVolume,
  stop,
  volumeDown,
  volumeUp,
} from '../api/beefweb.js'
import { useCoalescedWrite } from '../hooks/useCoalescedWrite.js'
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
    // The one thing the stream cannot tell us. `playlists` fires when the *set*
    // of playlists changes -- added, renamed, deleted -- and stays silent when
    // their contents change: measured against the live player, five items
    // copied in and two removed both produced a `player` message and nothing
    // else. So every `itemCount` here is stale from the first edit onwards, and
    // the views keyed on it (`playlistKey(id, itemCount)`) go on showing a list
    // the player no longer has.
    //
    // Coming back to the tab is when that is worth correcting, and it is the
    // one moment we know the desktop has had time to be used. Cheap, and it
    // costs nothing when nothing changed: an unchanged count is an unchanged
    // key, so no view reloads.
    refetchOnWindowFocus: true,
  })
}

// What the player will let this client do. A read-only instance must get a
// read-only Jean rather than buttons that come back 403.
export function usePermissions() {
  const { data } = usePlayer()
  return data?.player?.permissions ?? {}
}

// Rename, delete and reorder, written straight into the cache before the
// request goes out. The stream echoes the real state a moment later, but the
// sidebar is the thing being dragged -- it cannot wait a round trip to redraw.
//
// `index` is rewritten on every one of these because it is positional, and the
// player renumbers the whole list when any playlist moves or goes away.
const renumber = (playlists) => playlists.map((entry, index) => ({ ...entry, index }))

function usePlaylistPatch(mutationFn, patch) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: PLAYLISTS_KEY })
      const previous = queryClient.getQueryData(PLAYLISTS_KEY)
      if (previous) queryClient.setQueryData(PLAYLISTS_KEY, renumber(patch(previous, input)))
      return { previous }
    },

    // Both failure modes land here: the request was refused, or the player
    // does not allow it at all. Putting the list back is the honest response --
    // the caller reports it, and the affordance can then be withdrawn.
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(PLAYLISTS_KEY, context.previous)
    },
  })
}

export function usePlaylistActions() {
  const queryClient = useQueryClient()

  // The one playlist mutation that cannot be optimistic: only the player can
  // say what id the new playlist got, and everything that happens next --
  // selecting it, renaming it, dropping tracks on it -- is addressed by that id.
  const create = useMutation({
    mutationFn: async (title) => {
      const playlist = await createPlaylist(title)
      // Refetched rather than invalidated. What follows resolves against this
      // list, and a row that is not in it yet cannot be put into rename mode.
      await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
      return playlist
    },
  })

  const rename = usePlaylistPatch(
    ({ id, title }) => renamePlaylist(id, title),
    (playlists, { id, title }) =>
      playlists.map((entry) => (entry.id === id ? { ...entry, title } : entry)),
  )

  const remove = usePlaylistPatch(
    (id) => removePlaylist(id),
    (playlists, id) => playlists.filter((entry) => entry.id !== id),
  )

  const move = usePlaylistPatch(
    ({ id, index }) => movePlaylist(id, index),
    (playlists, { id, index }) => {
      const from = playlists.findIndex((entry) => entry.id === id)
      if (from < 0) return playlists
      const next = [...playlists]
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      return next
    },
  )

  return { create, rename, remove, move }
}

// foobar allows two playlists with the same name, but the sidebar gives you
// nothing else to tell them apart by. Numbered like a file manager does it.
export function untitledPlaylistName(playlists) {
  const base = 'New playlist'
  const taken = new Set(playlists.map((entry) => entry.title))
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
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

  // For "play this shuffled", which turns shuffle on rather than flipping it --
  // pressing it twice must not walk back out of the mode it just asked for.
  const enableShuffle = useCallback(() => {
    if (shuffleIndex < 0 || isShuffle) return
    mutation.mutate(shuffleIndex)
  }, [isShuffle, shuffleIndex, mutation])

  return {
    isShuffle,
    canShuffle: shuffleIndex >= 0,
    orderName: names[value] ?? null,
    toggleShuffle,
    enableShuffle,
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

// How long a value we just sent stays authoritative over what the player
// reports, if the player never confirms it. Long enough to cover a push that
// was already in flight describing an older position of the slider, short
// enough that turning the knob on the PC itself shows up promptly.
const VOLUME_SETTLE_MS = 1000
const VOLUME_EPSILON = 0.5

export function useVolume() {
  const { data } = usePlayer()
  const send = useCoalescedWrite(setVolume)
  const mute = usePlayerPatch(setMuted, (volume, isMuted) => ({ ...volume, isMuted }))
  const nudgeUp = useMutation({ mutationFn: volumeUp })
  const nudgeDown = useMutation({ mutationFn: volumeDown })

  // State, not a ref. A ref would not re-render, so the moment a drag ends and
  // the control stops showing the pointer position, it would fall back to the
  // last value the player reported -- visibly snapping to where the volume used
  // to be until the round trip lands.
  //
  // Kept here rather than in the query cache on purpose: this re-renders the
  // status bar, where a cache write would re-render every subscriber of player
  // state, including the virtualised track list, for the whole gesture.
  const [pending, setPending] = useState(null)

  const reported = data?.player?.volume ?? null

  useEffect(() => {
    if (pending === null || !reported) return undefined

    if (Math.abs(reported.value - pending) < VOLUME_EPSILON) {
      setPending(null)
      return undefined
    }

    // The player never confirmed. Hand control back rather than showing a value
    // that is no longer true.
    const timer = setTimeout(() => setPending(null), VOLUME_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [pending, reported])

  const setValue = useCallback(
    (value) => {
      setPending(value)
      send(value)
    },
    [send],
  )

  return {
    volume: reported && pending !== null ? { ...reported, value: pending } : reported,
    setValue,
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
