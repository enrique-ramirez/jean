import { useMemo } from 'react'

import { usePlayer, usePlaylists } from '../player/usePlayer.js'
import { isScratchPlaylist, scratchContentsOf, scratchName } from './jeanPlaylists.js'

// Where playback is coming from, when that is a set Jean materialised rather
// than a playlist the user can see.
//
// Browsing and playing are deliberately separate here: the scratch holds the
// last set you chose to play, so you can start a shelf and then wander off into
// All music without touching it. That freedom is only tolerable if the app can
// still tell you where the music is coming from -- otherwise the one hidden
// playlist in the design becomes the one thing you cannot account for.
//
// Read off the playlist's own title, which already carries the kind and the
// label, so this needs no state of Jean's own and is true after a reload and on
// another device.
export function usePlayingFrom() {
  const { data: playlists = [] } = usePlaylists()
  const { data: snapshot } = usePlayer()
  const activePlaylistId = snapshot?.player?.activeItem?.playlistId ?? null

  return useMemo(() => {
    const scratch = playlists.find(isScratchPlaylist)
    if (!scratch) return null

    const held = scratchContentsOf(scratch)
    // Named, not labelled. All Music carries no label -- there is one of it and
    // the kind says so -- and requiring one here is what left the row it plays
    // from unmarked and the status bar with nothing to say about it.
    const name = scratchName(held)
    if (!name) return null

    return {
      ...held,
      name,
      // The active item's playlist, not `isCurrent`: that keeps pointing at the
      // last playlist played from long after playback stopped, which would
      // leave a volume icon burning next to a set nobody is listening to.
      isPlaying: activePlaylistId === scratch.id,
    }
  }, [playlists, activePlaylistId])
}
