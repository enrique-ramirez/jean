import { useCallback } from 'react'

import { SCRATCH_KIND } from '../library/jeanPlaylists.js'
import { usePlaySet } from '../library/usePlaySet.js'
import { usePlaybackOrder } from '../player/usePlayer.js'
import { refsOfShelf } from './shelves.js'

// The two things the home screen can start, and both of them navigate as well
// as play: pressing a record on a shelf should leave you looking at the shelf,
// and shuffling the library should leave you looking at the library. Neither
// wants the row it was pressed from to be the last thing on screen.
export function useHomePlayback({ library, playlists, navigate }) {
  const { play, canPlaySets } = usePlaySet({ library, playlists })
  const order = usePlaybackOrder()

  // Clicking an album on a shelf plays the *shelf*, starting at that album.
  //
  // The alternative -- play only the album clicked -- makes every shelf a set of
  // twenty dead ends: the record finishes and playback falls out of the shelf
  // into whatever the player finds next. Filling the whole row means the shelf
  // is the thing you are listening to, so what follows the album is the next
  // album on it, which is what a shelf is for.
  const playShelf = useCallback(
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
      await play({ kind: SCRATCH_KIND.shelf, label: shelf.title, refs, position })
    },
    [play, navigate],
  )

  // The front door's own two, and they are the same two a playlist header has,
  // meaning the same two things: Play starts at the beginning, Shuffle starts
  // anywhere and turns the mode on. Both land you on All Music, because that is
  // the view of the set they just started -- pressing play should not leave you
  // looking at the screen you pressed it from.
  const startEverything = useCallback(
    async (refs, position) => {
      if (refs.length === 0) return
      navigate('/all')
      await play({ kind: SCRATCH_KIND.all, label: '', refs, position })
    },
    [play, navigate],
  )

  const playEverything = useCallback((refs) => startEverything(refs, 0), [startEverything])

  // The mode first and then a track, which is the same two requests the Shuffle
  // beside a playlist's Play sends -- *measured*, `POST /player/play` makes that
  // playlist the active one and the mode does the shuffling from there, so this
  // only has to open the door. Neither button touches the mode the other way
  // round: it is global player state, the status bar owns it, and a Play that
  // quietly turned shuffle off would be reaching across the app to do it.
  const shuffleEverything = useCallback(
    (refs) => {
      if (refs.length === 0) return
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
