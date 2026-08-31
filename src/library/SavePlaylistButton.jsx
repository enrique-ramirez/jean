import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListPlus } from 'lucide-react'

import { copyPlaylistItems, createPlaylist } from '../api/beefweb.js'
import { PLAYLISTS_KEY } from '../player/usePlayer.js'
import { Button } from '../ui/Button.jsx'
import { Menu } from '../ui/Menu.jsx'
import styles from './SavePlaylistButton.module.css'

// The one place Jean writes a playlist, and it takes an explicit click to get
// here: browsing and searching never do. Copying is by index -- the player
// already holds these tracks -- so nothing is uploaded but a list of numbers.
export function SavePlaylistButton({ search, isOpen, onOpenChange, onOpenPlaylist }) {
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
      const playlist = await createPlaylist(title.trim())
      await copyPlaylistItems(search.playlist.id, playlist.id, indices)
      // Refetched rather than invalidated: the route that follows resolves
      // against this list, and navigating to an id it has not seen yet would
      // land on the old view until the stream caught up.
      await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY })
      return playlist
    },
    onSuccess: (playlist) => {
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
          disabled={trackCount === 0 || search.isLoading}
          title={search.isLoading ? 'Still reading your library' : undefined}
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
