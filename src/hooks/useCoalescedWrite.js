import { useCallback, useRef } from 'react'

// Sends the first value immediately, then keeps only the newest while a request
// is in flight and sends that once the current one settles.
//
// One pointer gesture is ~40 moves. A debounce delays the first change, and you
// want to hear volume move as you drag it; a request per event is worse, since
// they can complete out of order and the value that *lands* last wins rather
// than the one sent last. This keeps exactly one in flight and always converges
// on the final value.
export function useCoalescedWrite(write) {
  const writeRef = useRef(write)
  writeRef.current = write

  const inFlight = useRef(false)
  const pending = useRef(null)

  const flush = useCallback(async () => {
    if (inFlight.current || pending.current === null) return

    const value = pending.current
    pending.current = null
    inFlight.current = true

    try {
      await writeRef.current(value)
    } catch {
      // Leave the local value alone; the player's next push corrects it.
    } finally {
      inFlight.current = false
      // Deliberately not guarded on being mounted: a value queued behind the
      // last request is the one the user finished on, so it should land even if
      // the control has gone away -- and a mounted flag reset in an effect
      // cleanup is never restored by StrictMode's remount, which would silently
      // drop every coalesced write in development.
      flush()
    }
  }, [])

  return useCallback(
    (value) => {
      pending.current = value
      flush()
    },
    [flush],
  )
}
