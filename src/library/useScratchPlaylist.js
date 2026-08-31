import { useCallback, useMemo, useRef, useState } from 'react'

import {
  copyPlaylistItems,
  createPlaylist,
  removePlaylistItems,
  renamePlaylist,
} from '../api/beefweb.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { isScratchPlaylist, scratchTitle } from './scratchPlaylist.js'

// Resolved by stored id, falling back to the title -- the same ladder
// useLibraryPlaylist climbs, and for the same reason: playlist ids are neither
// contiguous nor promised to outlive the player process, while the title is
// ours and recognisable from any device.
export function useScratchPlaylist({ playlists, viewKey, canEdit }) {
  const [pinnedId, setPinnedId] = useStoredState('jean.scratchPlaylist', null)

  const playlist = useMemo(() => {
    const byId = pinnedId ? playlists.find((entry) => entry.id === pinnedId) : null
    return byId ?? playlists.find(isScratchPlaylist) ?? null
  }, [playlists, pinnedId])

  // What the playlist currently holds, as far as this client knows. State
  // rather than a ref because the now-playing highlight is derived from it: a
  // result set that has been typed past is no longer the thing playing, and
  // lighting up whichever row now sits at that position would be a lie.
  const [held, setHeld] = useState(null)

  const holdsCurrentView =
    Boolean(playlist) &&
    held?.viewKey === viewKey &&
    // Another client may have rebuilt it for its own search since.
    held?.count === playlist.itemCount

  // Serialised: two quick clicks would otherwise interleave a rebuild with a
  // refill and leave the playlist holding half of each.
  const pending = useRef(null)

  const ensure = useCallback(
    async ({ sourceId, indices, query }) => {
      if (!canEdit || !sourceId || indices.length === 0) return null
      if (holdsCurrentView) return playlist.id

      const build = async () => {
        let target = playlist
        if (!target) {
          target = await createPlaylist(scratchTitle(query))
          setPinnedId(target.id)
        } else if (target.title !== scratchTitle(query)) {
          await renamePlaylist(target.id, scratchTitle(query))
        }

        // Emptied before refilling rather than replaced wholesale: there is no
        // replace-by-index endpoint, only add-by-path. Measured against the
        // live player, removing every item leaves the current track playing but
        // detached -- activeItem.index goes to -1 -- which is harmless here
        // because a play always follows immediately.
        if (target.itemCount > 0) {
          await removePlaylistItems(target.id, Array.from({ length: target.itemCount }, (_, at) => at))
        }
        await copyPlaylistItems(sourceId, target.id, indices)

        setHeld({ viewKey, count: indices.length })
        return target.id
      }

      pending.current = (pending.current ?? Promise.resolve()).then(build, build)
      return pending.current
    },
    [canEdit, holdsCurrentView, playlist, viewKey, setPinnedId],
  )

  return { playlist, holdsCurrentView, ensure }
}
