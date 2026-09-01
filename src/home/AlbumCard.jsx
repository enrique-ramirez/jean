import { Artwork } from '../ui/Artwork.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import styles from './AlbumCard.module.css'

// One album on a shelf. The caption is the reason it is here -- "32 plays a
// track, last heard 2016" -- and it is the difference between a shelf and a
// query result. It sits under the artist rather than over the cover: a badge on
// the artwork covers the one thing the card exists to show.
export function AlbumCard({ album, caption, onPlay }) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onPlay}
      title={`${album.artist} — ${album.album}`}
    >
      <span className={styles.cover}>
        <Artwork src={album.artworkUrl} size="100%" alt="" className={styles.art} />
        {/* Compositor-only: the badge scales and fades, and never moves the
            card or reflows the row. */}
        <span className={styles.badge} aria-hidden="true">
          <PlayIcon size={18} strokeWidth={2.5} />
        </span>
      </span>

      <span className={styles.album}>{album.album}</span>
      <span className={styles.artist}>{album.artist}</span>
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </button>
  )
}
