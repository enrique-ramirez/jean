import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

// Where the cursor was, per view. Leaving a playlist for a search and coming
// back should put you where you left off, and the cursor is half of that -- the
// other half is the scroll offset, remembered in useScrollMemory. Bounded
// because a live search mints a new key on every keystroke.
const MAX_REMEMBERED = 50
const cursors = new Map()

function remember(key, cursor) {
  if (!key) return
  cursors.set(key, cursor)
  if (cursors.size > MAX_REMEMBERED) cursors.delete(cursors.keys().next().value)
}

// Cursor and selection live as indices in state, never as DOM focus. The
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
  // load -- resetting here would throw away the user's place on every chunk.
  useEffect(() => {
    setCursor((current) => clamp(current, total - 1))
  }, [total])

  const selectOnly = useCallback((index) => {
    anchor.current = index
    setCursor(index)
    setSelection(new Set([index]))
  }, [])

  const selectRange = useCallback((from, to) => {
    const [start, end] = from <= to ? [from, to] : [to, from]
    const next = new Set()
    for (let index = start; index <= end; index += 1) next.add(index)
    setSelection(next)
    setCursor(to)
  }, [])

  const toggle = useCallback((index) => {
    anchor.current = index
    setCursor(index)
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const selectFromEvent = useCallback(
    (index, event) => {
      if (event.shiftKey) selectRange(anchor.current, index)
      else if (event.metaKey || event.ctrlKey) toggle(index)
      else selectOnly(index)
    },
    [selectRange, selectOnly, toggle],
  )

  const moveCursor = useCallback(
    (delta, { extend = false } = {}) => {
      setCursor((current) => {
        const next = clamp(current + delta, total - 1)
        if (extend) {
          setSelection(() => {
            const [start, end] = anchor.current <= next ? [anchor.current, next] : [next, anchor.current]
            const range = new Set()
            for (let index = start; index <= end; index += 1) range.add(index)
            return range
          })
        } else {
          anchor.current = next
          setSelection(new Set([next]))
        }
        return next
      })
    },
    [total],
  )

  const moveCursorTo = useCallback(
    (index) => {
      const next = clamp(index, total - 1)
      anchor.current = next
      setCursor(next)
      setSelection(new Set([next]))
    },
    [total],
  )

  const selectAll = useCallback(() => {
    const next = new Set()
    for (let index = 0; index < total; index += 1) next.add(index)
    setSelection(next)
  }, [total])

  const clear = useCallback(() => setSelection(new Set()), [])

  // Memoised: a fresh object here would change identity every render and defeat
  // the memo on every row in the list.
  return useMemo(
    () => ({ cursor, selection, selectFromEvent, moveCursor, moveCursorTo, selectAll, clear }),
    [cursor, selection, selectFromEvent, moveCursor, moveCursorTo, selectAll, clear],
  )
}
