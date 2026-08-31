import { useCallback, useMemo, useRef } from 'react'

import {
  copyPlaylistItems,
  createPlaylist,
  removePlaylistItems,
  renamePlaylist,
} from '../api/beefweb.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { isScratchPlaylist, queryOfScratchPlaylist, scratchTitle } from './scratchPlaylist.js'

// Resolved by stored id, falling back to the title -- the same ladder
// useLibraryPlaylist climbs, and for the same reason: playlist ids are neither
// contiguous nor promised to outlive the player process, while the title is
// ours and recognisable from any device.
export function useScratchPlaylist({ playlists, query, count, canEdit }) {
  const [pinnedId, setPinnedId] = useStoredState('jean.scratchPlaylist', null)

  const playlist = useMemo(() => {
    const pinned = pinnedId ? playlists.find((entry) => entry.id === pinnedId) : null
    // The pin is checked, not trusted. Saving a set of results renames this
    // playlist into the user's, so a stale pin would hand their playlist back
    // to be emptied by the next search.
    const byId = isScratchPlaylist(pinned) ? pinned : null
    return byId ?? playlists.find(isScratchPlaylist) ?? null
  }, [playlists, pinnedId])

  // Whether it already holds what is on screen, read off the playlist itself
  // rather than remembered here: the title is the query that built it and the
  // count is how many matched. Derived that way it survives a reload and gives
  // the same answer on another device, where local state would give neither.
  const holdsCurrentView =
    Boolean(playlist) &&
    queryOfScratchPlaylist(playlist) === query &&
    playlist.itemCount === count

  // Serialised: two quick clicks would otherwise interleave a rebuild with a
  // refill and leave the playlist holding half of each.
  const pending = useRef(null)

  const ensure = useCallback(
    async ({ sourceId, indices }) => {
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
        return target.id
      }

      pending.current = (pending.current ?? Promise.resolve()).then(build, build)
      return pending.current
    },
    [canEdit, holdsCurrentView, playlist, query, setPinnedId],
  )

  // Saving these results as a playlist, when the scratch already *is* these
  // results: rename it and it stops being Jean's. Nothing is copied, the
  // duplicate that create-and-copy would leave behind never exists, and --
  // measured against the live player -- playback carries straight on through
  // the rename, same track, same position, because it is the same playlist.
  const adopt = useCallback(
    async (title) => {
      if (!playlist) return null
      await renamePlaylist(playlist.id, title)
      setPinnedId(null)
      return playlist.id
    },
    [playlist, setPinnedId],
  )

  return { playlist, holdsCurrentView, ensure, adopt }
}
