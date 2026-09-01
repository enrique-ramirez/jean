import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { AlbumCard } from './AlbumCard.jsx'
import styles from './ShelfRow.module.css'

// A shelf is a horizontal scroller, not a carousel. The distinction is the
// point: a carousel shows one thing and hides the rest behind an animation,
// which is lovely for eight albums and useless for a library. A scroller shows
// six at a time and is a native scroll -- so it flicks on a phone,
// shift-wheels on a desktop, and costs nothing.
export function ShelfRow({ shelf, onPlayAlbum }) {
  const scrollerRef = useRef(null)
  const [more, setMore] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const element = scrollerRef.current
    if (!element) return
    const max = element.scrollWidth - element.clientWidth
    setMore({ start: element.scrollLeft > 8, end: element.scrollLeft < max - 8 })
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, shelf.albums])

  // A page is whatever is currently visible, less a little overlap so nothing
  // is skipped over between presses.
  const page = (direction) => {
    const element = scrollerRef.current
    if (!element) return
    element.scrollBy({ left: direction * (element.clientWidth * 0.85), behavior: 'smooth' })
  }

  return (
    <section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
      {/* The heading opens the shelf, and only the heading: the blurb under it
          is a sentence explaining why these records are here, and a sentence
          that navigates when you brush it is a trap.

          Reference pass -- two shapes exist for this. Apple Music and Disney+
          make the title itself the target and hang a chevron off the end of the
          words; Spotify and Apple TV put a separate "Show all" at the far right
          of the row. Taken from the first: the chevron belongs to the title, so
          it travels with the text instead of floating in dead space a hundred
          pixels away, and it points at the row it opens. Rejected the second on
          two counts -- it is the shape Jean has the most to lose by copying,
          and it promises "all of them" when this opens the same albums that are
          already on screen, as tracks.

          An anchor rather than a button, because it is nothing but a
          destination: routing is the hash, so this needs no JavaScript at all
          and cmd- or middle-click opens it in a tab, which no button can do. */}
      <header className={styles.header}>
        <h2 className={styles.title} id={`shelf-${shelf.id}`}>
          <a className={styles.open} href={`#/shelf/${shelf.id}`}>
            {shelf.title}
            <ChevronRight
              className={styles.chevron}
              size={16}
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </a>
        </h2>
        <p className={styles.blurb}>{shelf.blurb}</p>
      </header>

      {/* The rail exists so the arrows have somewhere to sit that the scroller's
          own overflow cannot clip, and so they can be centred on the artwork
          without anyone measuring the heading above it. */}
      <div className={styles.rail}>
        <button
          type="button"
          className={`${styles.arrow} ${styles.back}`}
          aria-label={`Scroll ${shelf.title} back`}
          disabled={!more.start}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={17} strokeWidth={2.5} />
        </button>

        <div
          className={styles.scroller}
          ref={scrollerRef}
          onScroll={measure}
          data-more-start={more.start}
          data-more-end={more.end}
        >
          {shelf.albums.map((album) => (
            <AlbumCard
              key={album.key}
              album={album}
              caption={shelf.caption(album)}
              onPlay={() => onPlayAlbum(shelf, album)}
            />
          ))}
        </div>

        <button
          type="button"
          className={`${styles.arrow} ${styles.forward}`}
          aria-label={`Scroll ${shelf.title} forward`}
          disabled={!more.end}
          onClick={() => page(1)}
        >
          <ChevronRight size={17} strokeWidth={2.5} />
        </button>
      </div>
    </section>
  )
}
