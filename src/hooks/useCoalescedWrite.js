import { useCallback, useRef } from 'react'

// Sends the first value immediately, then keeps only the newest value while a
// request is in flight and sends that once the current one settles.
//
// A debounce is the wrong tool here: it delays the first change, and you want
// to hear volume move as you drag it. Firing per pointer event is worse -- the
// requests can complete out of order, so the value that lands last wins rather
// than the value sent last, and each one comes back as a push that re-renders
// everything subscribed to player state.
//
// This keeps exactly one request in flight and always converges on the final
// value, because whatever arrived during the last flight is sent after it.
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
      // Deliberately not guarded on being mounted. A value queued behind the
      // last request is the one the user finished on, so it should still land
      // even if the control has since gone away -- and a mounted flag reset in
      // an effect cleanup is never restored by StrictMode's remount, which
      // silently drops every coalesced write.
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
