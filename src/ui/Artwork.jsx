import { useState } from 'react'
import { Disc3 } from 'lucide-react'

import styles from './Artwork.module.css'

// The artwork endpoint 404s when a track has no embedded cover, which is common
// enough that it is a normal state rather than an error. Native lazy loading is
// enough here: only rows the virtualiser has mounted exist in the DOM at all.
// Takes a URL, not an address. Where artwork lives is the source's business:
// a playlist addresses it by index, the media library by path, and the status
// bar by whatever the player is currently on.
export function Artwork({ src, size, alt = '', className }) {
  const [failed, setFailed] = useState(false)
  const classes = [styles.artwork, className].filter(Boolean).join(' ')
  const style = { width: size, height: size }

  if (failed || !src) {
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
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable="false"
      onError={() => setFailed(true)}
    />
  )
}
