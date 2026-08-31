import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  // Hover only counts if the pointer actually went somewhere.
  //
  // A dropdown that appears under a stationary cursor gets a mouseenter it did
  // not earn: the mouse has not moved, the element beneath it changed. That
  // happens on every open -- the results render exactly where the button that
  // opened them was -- and again on every keystroke, as a new set lands under
  // the same cursor. Measured, opening the finder and typing selected the fifth
  // result purely because that is where the pointer was sitting, and Enter then
  // plays that one instead of the first match.
  //
  // Two signals, because one is not enough. `moved` covers the ordinary case,
  // and is re-armed per result set since each new set is a fresh chance to land
  // something unaimed-at under the cursor -- in a layout effect, so the reset is
  // in place before the browser dispatches the mouseenter that follows paint.
  // The coordinate check covers the first move onto a result, where mouseenter
  // arrives *before* the mousemove that would have set the flag; there the
  // pointer is demonstrably somewhere new. With neither -- a mouse that has not
  // moved all session -- hover stays out of it, which is the safe way to be
  // wrong.
  const moved = useRef(false)
  const lastSeen = useRef(null)

  useEffect(() => {
    const track = (event) => {
      moved.current = true
      lastSeen.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousemove', track)
    return () => window.removeEventListener('mousemove', track)
  }, [])

  useLayoutEffect(() => {
    moved.current = false
  }, [results])

  const aimedAt = (event) => {
    if (moved.current) return true
    // The first enter after the finder opens has no earlier position to be
    // compared against -- the click that opened it happened before any of this
    // was listening -- so it is rejected and its coordinates become the
    // reference. Anything arriving from somewhere else afterwards is a real
    // move, whether or not a mousemove has been seen yet.
    const previous = lastSeen.current
    lastSeen.current = { x: event.clientX, y: event.clientY }
    return previous !== null && (event.clientX !== previous.x || event.clientY !== previous.y)
  }

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
                onMouseEnter={(event) => {
                  if (aimedAt(event)) setActive(position)
                }}
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
