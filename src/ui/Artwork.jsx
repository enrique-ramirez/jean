import { useState } from 'react'
import { Disc3 } from 'lucide-react'

import { artworkUrl } from '../api/beefweb.js'
import styles from './Artwork.module.css'

// The artwork endpoint 404s when a track has no embedded cover, which is common
// enough that it is a normal state rather than an error. Native lazy loading is
// enough here: only rows the virtualiser has mounted exist in the DOM at all.
export function Artwork({ playlistId, index, size, alt = '', className }) {
  const [failed, setFailed] = useState(false)
  const classes = [styles.artwork, className].filter(Boolean).join(' ')
  const style = { width: size, height: size }

  if (failed || index == null) {
    return (
      <div className={`${classes} ${styles.fallback}`} style={style} aria-hidden="true">
        <Disc3 size={typeof size === 'number' ? Math.round(size * 0.42) : 24} strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <img
      className={classes}
      style={style}
      src={artworkUrl(playlistId, index)}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable="false"
      onError={() => setFailed(true)}
    />
  )
}
