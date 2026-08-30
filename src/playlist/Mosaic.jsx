import { useMemo } from 'react'
import { Disc3 } from 'lucide-react'

import { Artwork } from '../ui/Artwork.jsx'
import styles from './Mosaic.module.css'

// Covers are ~46 KB each, so the tile count is capped rather than scaled with
// the playlist: nine images is the whole cost whether the playlist holds twelve
// tracks or thirty thousand.
const tileCountFor = (trackCount) => {
  if (trackCount === 0) return 0
  if (trackCount < 4) return 1
  if (trackCount < 24) return 4
  return 9
}

const hash = (text) => {
  let value = 0
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) >>> 0
  }
  return value
}

// Evenly spaced across the playlist rather than randomly sampled, so the tiles
// represent the whole thing instead of clustering. The offset is derived from
// the playlist id so two playlists of the same length still look different, and
// so a given playlist looks the same on every render.
const pickIndices = (playlistId, trackCount, tiles) => {
  if (tiles === 0) return []
  const stride = trackCount / tiles
  const offset = hash(playlistId) % Math.max(1, Math.floor(stride))
  return Array.from({ length: tiles }, (_, tile) =>
    Math.min(trackCount - 1, Math.floor(tile * stride) + offset),
  )
}

export function Mosaic({ playlistId, trackCount, size = 176 }) {
  const tiles = tileCountFor(trackCount)
  const indices = useMemo(
    () => pickIndices(playlistId, trackCount, tiles),
    [playlistId, trackCount, tiles],
  )

  if (tiles === 0) {
    return (
      <div className={`${styles.mosaic} ${styles.empty}`} style={{ width: size, height: size }}>
        <Disc3 size={32} strokeWidth={1.5} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className={styles.mosaic} data-tiles={tiles} style={{ width: size, height: size }}>
      {indices.map((index, position) => (
        <Artwork
          key={`${index}-${position}`}
          playlistId={playlistId}
          index={index}
          size="100%"
          className={styles.tile}
        />
      ))}
    </div>
  )
}
