import { useCallback } from 'react'

import { SCRATCH_KIND } from '../library/jeanPlaylists.js'
import { usePlaySet } from '../library/usePlaySet.js'
import { usePlaybackOrder } from '../player/usePlayer.js'
import { refsOfShelf } from './shelves.js'

// The two things the home screen can start, and both navigate as well as play:
// pressing a record on a shelf should leave you looking at the shelf, and
// starting the library should leave you looking at the library. Neither wants
// the row it was pressed from to be the last thing on screen.
export function useHomePlayback({ library, playlists, navigate }) {
  const { play, canPlaySets } = usePlaySet({ library, playlists })
  const order = usePlaybackOrder()

  // Clicking an album plays the *shelf*, starting at that album. Playing only
  // the album would make every shelf twenty dead ends: the record finishes and
  // playback falls out of the shelf into whatever the player finds next.
  const playShelf = useCallback(
    async (shelf, album) => {
      const refs = refsOfShelf(shelf)
      // Found by identity rather than arithmetic: the refs are the shelf's, so
      // the album's first ref is in there exactly once.
      const position = Math.max(0, refs.indexOf(album.refs[0]))

      // Navigate first. The fill is a round trip and the view it opens already
      // knows how to mark and follow whatever ends up playing, so the screen
      // changes immediately rather than after the player answers.
      navigate(`/shelf/${shelf.id}`)
      await play({ kind: SCRATCH_KIND.shelf, label: shelf.title, refs, position })
    },
    [play, navigate],
  )

  // Both land on All music, because that is the view of the set they just
  // started -- pressing play should not leave you looking at the screen you
  // pressed it from.
  const startEverything = useCallback(
    async (refs, position) => {
      if (refs.length === 0) return
      navigate('/all')
      await play({ kind: SCRATCH_KIND.all, label: '', refs, position })
    },
    [play, navigate],
  )

  const playEverything = useCallback((refs) => startEverything(refs, 0), [startEverything])

  // The mode first, then a track -- the same two requests the Shuffle beside a
  // playlist's Play sends. Neither button touches the mode the other way round:
  // it is global player state, the status bar owns it, and a Play that quietly
  // turned shuffle off would be reaching across the app to do it.
  const shuffleEverything = useCallback(
    (refs) => {
      if (refs.length === 0) return undefined
      order.enableShuffle()
      return startEverything(refs, Math.floor(Math.random() * refs.length))
    },
    [startEverything, order],
  )

  return {
    playShelf,
    playEverything,
    shuffleEverything,
    canPlay: canPlaySets,
    canShuffle: order.canShuffle && canPlaySets,
  }
}
