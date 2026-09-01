import { useEffect, useRef, useState } from 'react'
import { ListMusic, Search } from 'lucide-react'

import { fold, matchesTokens, tokenize } from '../ui/text.js'
import styles from './CommandPalette.module.css'

// Jumping between playlists, not searching them: tracks are the library
// field's job, up in the top bar, where it is visible on a phone as well.
export function CommandPalette({ playlists, onSelect, onDismiss }) {
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  // The same rule as every other list you can type at, through the same
  // fold(): a palette that could not find `Babasónicos` from `babasonicos`
  // would be the one place in the app where accents suddenly matter.
  const tokens = tokenize(query)
  const results =
    tokens.length === 0
      ? playlists
      : playlists.filter((playlist) => matchesTokens(fold(playlist.title), tokens))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [query])

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + results.length) % Math.max(results.length, 1))
    } else if (event.key === 'Enter' && results[active]) {
      onSelect(results[active].id)
    } else if (event.key === 'Escape') {
      onDismiss()
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Go to playlist">
        <div className={styles.field}>
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to playlist"
            aria-label="Go to playlist"
            spellCheck="false"
            autoComplete="off"
          />
        </div>

        <div className={styles.results} role="listbox">
          {results.length === 0 ? (
            <p className={styles.empty}>No playlist matches that.</p>
          ) : (
            results.map((playlist, position) => (
              <button
                key={playlist.id}
                type="button"
                role="option"
                aria-selected={position === active}
                className={styles.result}
                data-active={position === active}
                onMouseEnter={() => setActive(position)}
                onClick={() => onSelect(playlist.id)}
              >
                <ListMusic size={15} strokeWidth={2} aria-hidden="true" />
                {playlist.title}
                <span className={styles.count}>{playlist.itemCount.toLocaleString()}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
