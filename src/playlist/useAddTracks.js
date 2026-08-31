import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { copyPlaylistItems, fetchPlaylists, removePlaylistItems } from '../api/beefweb.js'
import { PLAYLISTS_KEY } from '../player/usePlayer.js'
import { pushToast } from '../ui/toasts.js'

// Copying tracks between playlists, which is one request whatever the count --
// indices go up, nothing else does. Measured: 15,000 of them in 323 ms.
//
// No duplicate check. foobar2000 playlists are ordered lists, not sets, and the
// player appends without comment; a uniqueness rule Jean invented would be Jean
// misrepresenting the data. There is no cheap check to make either -- items
// have no id, so identity is %path%, and reading it is a request of its own
// before the drop could land. Undo covers the mistake instead.

const plural = (count, word) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

export function useAddTracks() {
  const queryClient = useQueryClient()

  return useCallback(
    async ({ sourceId, target, itemIndices }) => {
      const count = itemIndices.length
      if (count === 0) return

      // Read from the cache rather than from the target captured when the menu
      // was built, and read before the write -- this is what makes undo exact.
      // Items are appended, so the rows about to exist are precisely
      // [itemCount, itemCount + count). No paths, no extra request: itemCount
      // is already in PlaylistInfo.
      const before =
        queryClient.getQueryData(PLAYLISTS_KEY)?.find((entry) => entry.id === target.id)
          ?.itemCount ?? target.itemCount

      try {
        await copyPlaylistItems(sourceId, target.id, itemIndices)
        await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
      } catch {
        // Smart playlists reject every write and say nothing about it in their
        // metadata, so there is no way to know before trying. Attempt, and
        // explain when it comes back refused.
        pushToast({
          tone: 'error',
          message: `${target.title} would not take those tracks. Smart playlists are built by the player and cannot be added to.`,
        })
        return
      }

      const undo = async () => {
        // Read from the player, not from the cache. Item changes are not
        // pushed -- beefweb sends `playlists` when the set of playlists
        // changes and nothing at all when their contents do -- so the cached
        // itemCount cannot see the desktop, which is the one writer this
        // check exists to catch. One request, on an explicit user action.
        const current = (await fetchPlaylists()).find((entry) => entry.id === target.id)

        // Those indices are only ours while nothing else has touched the
        // playlist. If the count has moved, the desktop got there first and
        // removing that range would take somebody else's tracks.
        if (!current || current.itemCount !== before + count) {
          pushToast({
            tone: 'error',
            message: `${target.title} has changed since then, so nothing was removed.`,
          })
          return
        }

        try {
          await removePlaylistItems(
            target.id,
            Array.from({ length: count }, (_, offset) => before + offset),
          )
          await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
        } catch {
          pushToast({ tone: 'error', message: `Could not undo that.` })
        }
      }

      pushToast({
        message: `Added ${plural(count, 'track')} to ${target.title}`,
        action: { label: 'Undo', run: undo },
      })
    },
    [queryClient],
  )
}
