import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clamp } from '../ui/math.js'

// Where the cursor was, per view. Leaving a playlist for a search and coming
// back should put you where you left off, and the cursor is half of that -- the
// other half is the scroll offset, in useScrollMemory. Bounded, because a live
// search mints a new key on every keystroke.
const MAX_REMEMBERED = 50
const cursors = new Map()

function remember(key, cursor) {
  if (!key) return
  cursors.set(key, cursor)
  if (cursors.size > MAX_REMEMBERED) cursors.delete(cursors.keys().next().value)
}

const rangeBetween = (from, to) => {
  const [start, end] = from <= to ? [from, to] : [to, from]
  return new Set(Array.from({ length: end - start + 1 }, (_, at) => start + at))
}

// Cursor and selection live as indices in state, never as DOM focus: the
// virtualiser unmounts the focused row the moment it scrolls out of view, so
// anything relying on document.activeElement loses its place. Rows are plain
// divs; the list element owns keyboard focus.
export function useTrackSelection(total, viewKey) {
  const [cursor, setCursor] = useState(() => cursors.get(viewKey) ?? 0)
  const [selection, setSelection] = useState(() => new Set())
  const anchor = useRef(0)

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  // Saved on the way out rather than on every move: the cleanup runs with the
  // key it was registered under, so the value cannot land under the new one.
  useEffect(() => () => remember(viewKey, cursorRef.current), [viewKey])

  useEffect(() => {
    const restored = cursors.get(viewKey) ?? 0
    anchor.current = restored
    setCursor(restored)
    setSelection(new Set())
  }, [viewKey])

  // Clamp only. Rows arrive in chunks, so `total` grows several times during a
  // load, and resetting here would throw away the user's place on every chunk.
  useEffect(() => {
    setCursor((current) => clamp(current, 0, Math.max(total - 1, 0)))
  }, [total])

  const moveCursorTo = useCallback(
    (index) => {
      const next = clamp(index, 0, Math.max(total - 1, 0))
      anchor.current = next
      setCursor(next)
      setSelection(new Set([next]))
    },
    [total],
  )

  const selectFromEvent = useCallback((index, event) => {
    if (event.shiftKey) {
      setSelection(rangeBetween(anchor.current, index))
      setCursor(index)
      return
    }

    anchor.current = index
    setCursor(index)

    if (event.metaKey || event.ctrlKey) {
      setSelection((current) => {
        const next = new Set(current)
        if (!next.delete(index)) next.add(index)
        return next
      })
    } else {
      setSelection(new Set([index]))
    }
  }, [])

  const moveCursor = useCallback(
    (delta, { extend = false } = {}) => {
      setCursor((current) => {
        const next = clamp(current + delta, 0, Math.max(total - 1, 0))
        if (extend) {
          setSelection(rangeBetween(anchor.current, next))
        } else {
          anchor.current = next
          setSelection(new Set([next]))
        }
        return next
      })
    },
    [total],
  )

  const selectAll = useCallback(
    () => setSelection(new Set(Array.from({ length: total }, (_, index) => index))),
    [total],
  )

  const clear = useCallback(() => setSelection(new Set()), [])

  // Memoised: a fresh object here would change identity every render and defeat
  // the memo on every row in the list.
  return useMemo(
    () => ({ cursor, selection, selectFromEvent, moveCursor, moveCursorTo, selectAll, clear }),
    [cursor, selection, selectFromEvent, moveCursor, moveCursorTo, selectAll, clear],
  )
}
