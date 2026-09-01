import { useCallback } from 'react'

import { playItem } from '../api/beefweb.js'
import { SCRATCH_KIND } from '../library/jeanPlaylists.js'
import { useScratchPlaylist } from '../library/useScratchPlaylist.js'
import { usePermissions } from '../player/usePlayer.js'
import { refsOfShelf } from './shelves.js'

// Clicking an album on a shelf plays the *shelf*, starting at that album.
//
// The alternative -- play only the album clicked -- makes every shelf a set of
// twenty dead ends: the record finishes and playback falls out of the shelf
// into whatever the player finds next. Filling the whole row means the shelf is
// the thing you are listening to, so what follows the album is the next album
// on it, which is what a shelf is for.
export function usePlayShelf({ library, playlists, navigate }) {
  const permissions = usePermissions()
  const scratch = useScratchPlaylist({ playlists, canEdit: permissions.changePlaylists !== false })

  return useCallback(
    async (shelf, album) => {
      const refs = refsOfShelf(shelf)
      // Where this album starts inside the row, which is the position to play.
      // Found by identity rather than arithmetic: the refs are concatenated in
      // shelf order, so the album's first ref is in there exactly once.
      const first = album.refs[0]
      let position = 0
      for (let at = 0; at < refs.length; at += 1) {
        if (refs[at] === first) {
          position = at
          break
        }
      }

      // Navigate first. The fill is a round trip, and the view it opens already
      // knows how to mark and follow whatever ends up playing -- so the screen
      // changes immediately rather than after the player answers.
      navigate(`/shelf/${shelf.id}`)

      const id = await scratch.ensure({
        kind: SCRATCH_KIND.shelf,
        label: shelf.title,
        refs,
        source: library.source,
      })
      if (id) playItem(id, position)
      else if (library.playlist) playItem(library.playlist.id, first)
    },
    [scratch, library.source, library.playlist, navigate],
  )
}
