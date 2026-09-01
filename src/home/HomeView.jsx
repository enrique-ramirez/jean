import { useMemo } from 'react'

import { LibrarySetup } from '../library/LibrarySetup.jsx'
import { albumsOf } from './albums.js'
import { buildShelves } from './shelves.js'
import { ShelfRow } from './ShelfRow.jsx'
import styles from './HomeView.module.css'

// Rows, not one big carousel. A carousel is lovely for eight albums and useless
// for two thousand -- it was iTunes' Cover Flow, and Cover Flow was removed
// because it could not browse. Each row here is a *reason* instead: a small set
// with a sentence attached, which is a thing to press play on rather than a
// thing to page through.
export function HomeView({ library, playlists, onPlayAlbum }) {
  // Once per library, not per render: the aggregation is a pass over every row
  // (6.5 ms at 30k, 35 ms at 213k) and the shelves are sorts over the result.
  const shelves = useMemo(() => {
    if (library.rows.length === 0) return []
    const albums = albumsOf(library)
    for (const album of albums) album.artworkUrl = library.source.artworkUrl(album.refs[0])
    return buildShelves(albums)
  }, [library.key, library.rows, library.source])

  if (library.needsSetup) {
    return <LibrarySetup playlists={playlists} />
  }

  if (library.error) {
    return <p className={styles.notice}>Could not read your library -- {library.error.message}</p>
  }

  // Deliberately not a spinner over an empty screen: the first chunk paints in
  // well under a second and the shelves appear under the heading as they fill.
  return (
    <div className={styles.home}>
      {/* No wordmark here. It sits two centimetres above in the top bar, and
          repeating it makes the screen about the app rather than about the
          music on it. */}
      <header className={styles.head}>
        <h1 className={styles.title}>Your library</h1>
        {library.count > 0 ? (
          <p className={styles.stat}>{library.count.toLocaleString()} tracks</p>
        ) : null}
      </header>

      {shelves.length === 0 ? (
        <p className={styles.notice}>
          {library.isLoading ? 'Reading your library...' : 'Nothing to show from your library yet.'}
        </p>
      ) : (
        <div className={styles.shelves}>
          {shelves.map((shelf) => (
            <ShelfRow key={shelf.id} shelf={shelf} onPlayAlbum={onPlayAlbum} />
          ))}
        </div>
      )}
    </div>
  )
}
