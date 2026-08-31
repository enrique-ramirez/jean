import { AlertTriangle, ListMusic } from 'lucide-react'

import styles from './LibrarySetup.module.css'

// foobar's scratch buffer: selecting an album in its library view replaces the
// whole thing. Measured once at 30,441 items and 12 an hour later. It can look
// like a library for exactly as long as it takes to mislead you.
const SCRATCH_TITLE = 'Default Playlist'

export function LibraryPicker({ playlists, currentId, onChoose }) {
  return (
    <div className={styles.picker} role="list">
      {playlists.map((playlist) => (
        <button
          key={playlist.id}
          type="button"
          role="listitem"
          className={styles.option}
          aria-current={playlist.id === currentId}
          onClick={() => onChoose(playlist)}
        >
          <ListMusic size={15} strokeWidth={2} aria-hidden="true" />
          <span className={styles.optionTitle}>{playlist.title}</span>
          {playlist.title === SCRATCH_TITLE ? (
            <span className={styles.warning}>
              <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
              foobar clears this one
            </span>
          ) : null}
          <span className={styles.optionCount}>{playlist.itemCount.toLocaleString()}</span>
        </button>
      ))}
    </div>
  )
}

// beefweb sees playlists and the filesystem, and that is the whole surface --
// the Media Library is invisible to it. An autoplaylist is the way through:
// made once, it appears like any other playlist and stays in sync afterwards.
export function LibrarySetup({ playlists, currentId, onChoose }) {
  return (
    <div className={styles.setup}>
      <p className={styles.eyebrow}>Search</p>
      <h1 className={styles.title}>Point Jean at your library</h1>

      <p className={styles.body}>
        beefweb can only see playlists, so foobar2000's Media Library has to become one. In
        foobar2000: <b>Library → Search</b>, enter <code>ALL</code> as the query, then save it as an
        autoplaylist called <b>Library</b>. It holds every track you have and keeps itself in sync.
      </p>

      <p className={styles.aside}>
        Jean only ever reads it. Nothing here creates, clears or reorders a playlist.
      </p>

      <p className={styles.label}>Or search an existing playlist:</p>
      <LibraryPicker playlists={playlists} currentId={currentId} onChoose={onChoose} />
    </div>
  )
}
