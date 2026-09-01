import { useMemo } from 'react'
import { Disc3 } from 'lucide-react'

import { Artwork } from '../ui/Artwork.jsx'
import styles from './Mosaic.module.css'

// The tile count is capped rather than scaled with the playlist: nine images is
// the whole cost whether it holds twelve tracks or the entire library.
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

// Evenly spaced across the set rather than randomly sampled, so the tiles
// represent the whole thing instead of clustering. The offset is derived from
// the seed so two lists of the same length still look different, and so a given
// list looks the same on every render.
const pickPositions = (seed, trackCount, tiles) => {
  if (tiles === 0) return []
  const stride = trackCount / tiles
  const offset = hash(seed) % Math.max(1, Math.floor(stride))
  return Array.from({ length: tiles }, (_, tile) =>
    Math.min(trackCount - 1, Math.floor(tile * stride) + offset),
  )
}

// `indices` maps a position in the set back to the ref the source addresses
// artwork by; without it the set is the whole list and the two are the same.
export function Mosaic({ source, trackCount, indices = null, seed = null, size = 176 }) {
  const tiles = tileCountFor(trackCount)
  const positions = useMemo(
    () => pickPositions(seed, trackCount, tiles).map((position) => (indices ? indices[position] : position)),
    [seed, trackCount, tiles, indices],
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
      {positions.map((index, position) => (
        <Artwork
          key={`${index}-${position}`}
          src={source.artworkUrl(index)}
          size="100%"
          className={styles.tile}
        />
      ))}
    </div>
  )
}
