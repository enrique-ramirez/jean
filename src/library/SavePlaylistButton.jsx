import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListPlus } from 'lucide-react'

import { createPlaylist } from '../api/beefweb.js'
import { PLAYLISTS_KEY } from '../player/usePlayer.js'
import { Button } from '../ui/Button.jsx'
import { Menu } from '../ui/Menu.jsx'
import styles from './SavePlaylistButton.module.css'

// The one place Jean writes a playlist, and it takes an explicit click to get
// here: browsing and searching never do. How the tracks get across is the
// source's business: an autoplaylist copies by index, so nothing is uploaded
// but a list of numbers, and the media library adds by `(path, subsong)`
// because there is no playlist to copy *from*.
//
// Reaching past the source for a playlist id was not untidy, it was wrong, and
// silently. A ref is only an index *into its own source*: on a player with a
// media library those refs address the library's own path-ordered array, and
// copying them out of the `Library` autoplaylist instead took whatever happened
// to sit at those positions in a differently ordered list. Measured, saving
// twelve unplayed Babasónicos matches wrote a playlist beginning "Jaws Theme
// Swimming". It never threw, which is what made it worth a test.
export function SavePlaylistButton({ search, library, scratch, holdsResults, isOpen, onOpenChange, onOpenPlaylist }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(search.query)
  const inputRef = useRef(null)

  const { indices } = search.results
  const trackCount = indices.length

  // The query is the obvious name, and the obvious name is usually right. It
  // follows the field until the dialog is opened, then stops moving under the
  // cursor while it is being edited.
  useEffect(() => {
    if (!isOpen) setTitle(search.query)
  }, [isOpen, search.query])

  useEffect(() => {
    if (isOpen) inputRef.current?.select()
  }, [isOpen])

  const save = useMutation({
    mutationFn: async () => {
      const name = title.trim()

      // If playing these results already built a playlist of exactly them, that
      // playlist *is* what is being saved -- so rename it rather than making a
      // second copy beside it. Playback carries straight on through the rename,
      // and the scratch stops existing because it stops being Jean's, which is
      // what takes the search out of the sidebar.
      if (holdsResults) {
        const id = await scratch.adopt(name)
        await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
        return { id, title: name }
      }

      const playlist = await createPlaylist(name)
      await library.source.addTo(playlist.id, indices)
      // Refetched rather than invalidated: the route that follows resolves
      // against this list, and navigating to an id it has not seen yet would
      // land on the old view until the stream caught up.
      await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
      return playlist
    },
    onSuccess: (playlist) => {
      // The results have somewhere permanent to live now, so the search that
      // made them is done -- and with it the scratch playlist, which was only
      // ever the temporary version of what was just saved.
      search.clear()
      onOpenChange(false)
      onOpenPlaylist(playlist.id)
    },
  })

  const submit = (event) => {
    event.preventDefault()
    if (title.trim().length > 0 && !save.isPending) save.mutate()
  }

  return (
    <Menu
      isOpen={isOpen}
      onDismiss={() => onOpenChange(false)}
      align="start"
      trigger={
        <Button
          icon={ListPlus}
          aria-expanded={isOpen}
          // Saving a set that is still filling in would quietly write a
          // fraction of the matches and look like the whole answer.
          disabled={trackCount === 0 || library.isLoading}
          title={library.isLoading ? 'Still reading your library' : undefined}
          onClick={() => onOpenChange(!isOpen)}
        >
          Save as playlist
        </Button>
      }
    >
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="save-search-title">
          New playlist from {trackCount.toLocaleString()}{' '}
          {trackCount === 1 ? 'result' : 'results'}
        </label>

        <input
          id="save-search-title"
          ref={inputRef}
          className={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Playlist name"
          aria-label="Playlist name"
          spellCheck="false"
          autoComplete="off"
          autoFocus
        />

        {save.error ? <p className={styles.error}>Could not save -- {save.error.message}</p> : null}

        <div className={styles.actions}>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={title.trim().length === 0 || save.isPending}
          >
            {save.isPending ? 'Saving...' : 'Create'}
          </Button>
        </div>
      </form>
    </Menu>
  )
}
