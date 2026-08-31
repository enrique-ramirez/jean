import { useCallback, useEffect, useMemo } from 'react'

import { useStoredState } from '../hooks/useStoredState.js'
import { sameTagValue } from '../playlist/fields.js'

// What the setup guide asks people to call it. Only a fallback: the pin is what
// actually decides, and any playlist can be pinned.
const CONVENTIONAL_TITLE = 'Library'

// beefweb has no library API, so "the library" is whichever playlist the user
// points Jean at -- an autoplaylist of the whole Media Library, if they took
// the setup route. Which one that is has to survive restarts, and playlist ids
// do not: they are neither contiguous nor promised to outlive the player
// process. So the id is a hint and the title is the backstop.
export function useLibraryPlaylist(playlists) {
  const [pinned, setPinned] = useStoredState('jean.library', null)

  const playlist = useMemo(() => {
    if (playlists.length === 0) return null

    const byId = pinned?.id ? playlists.find((entry) => entry.id === pinned.id) : null
    const byTitle = pinned?.title
      ? playlists.find((entry) => sameTagValue(entry.title, pinned.title))
      : null
    const byConvention = playlists.find((entry) => sameTagValue(entry.title, CONVENTIONAL_TITLE))

    return byId ?? byTitle ?? byConvention ?? null
  }, [playlists, pinned])

  // Re-pin whenever resolution had to fall back, so the next run is a straight
  // id hit and a rename does not strand us on a title that no longer exists.
  useEffect(() => {
    if (!playlist) return
    if (playlist.id === pinned?.id && playlist.title === pinned?.title) return
    setPinned({ id: playlist.id, title: playlist.title })
  }, [playlist, pinned, setPinned])

  const choose = useCallback(
    (entry) => setPinned({ id: entry.id, title: entry.title }),
    [setPinned],
  )

  return { playlist, choose, isPinned: Boolean(pinned) }
}
