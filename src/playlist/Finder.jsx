import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { useDebounced } from '../hooks/useDebounced.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { SCOPE } from '../keyboard/keymap.js'
import { FIELD, value } from './fields.js'
import styles from './Finder.module.css'

// Finds without filtering. The playlist keeps every track and its order; this
// only moves you to one. Arrowing through results scrolls the list so you see
// each hit in place, and only Enter starts playback -- browsing should never
// hijack what is playing.
export function Finder({ rows, results, matches, query, onQueryChange, onPreview, onConfirm, onClose }) {
  const inputRef = useRef(null)
  const [active, setActive] = useState(0)
  const debouncedActive = useDebounced(active, 90)

  // Held in a ref: the parent passes a new closure every render, and depending
  // on it directly would make previewing re-run itself forever.
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const index = results[debouncedActive]
    if (index !== undefined) previewRef.current(index)
  }, [debouncedActive, results])

  const step = (delta) => {
    if (results.length === 0) return
    setActive((current) => (current + delta + results.length) % results.length)
  }

  useKeymap(SCOPE.finder, {
    finderNext: () => step(1),
    finderPrevious: () => step(-1),
    finderConfirm: () => {
      const index = results[active]
      if (index !== undefined) onConfirm(index)
    },
    finderClose: onClose,
  })

  return (
    <div className={styles.finder}>
      <Search size={15} strokeWidth={2} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Find in this playlist"
        aria-label="Find in this playlist"
        spellCheck="false"
        autoComplete="off"
      />
      {matches ? <span className={styles.count}>{matches.size}</span> : null}
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close finder">
        <X size={14} strokeWidth={2} />
      </button>

      {query.trim().length > 0 ? (
        <div className={styles.results} role="listbox">
          {results.length === 0 ? (
            <p className={styles.empty}>Nothing here matches that.</p>
          ) : (
            results.map((index, position) => (
              <button
                key={index}
                type="button"
                role="option"
                aria-selected={position === active}
                className={styles.result}
                data-active={position === active}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onConfirm(index)}
                onMouseEnter={() => setActive(position)}
              >
                <span className={styles.names}>
                  <span className={styles.resultTitle}>{value(rows[index], FIELD.title) ?? 'Unknown'}</span>
                  <span className={styles.resultArtist}>
                    {value(rows[index], FIELD.artist) ?? 'Unknown artist'}
                  </span>
                </span>
                <span className={styles.position}>#{index + 1}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
