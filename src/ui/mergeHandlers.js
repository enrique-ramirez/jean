// Composes several sets of React event props onto one element, running every
// handler registered for a name in the order given.
//
// Needed the moment two behaviours listen to the same element: a row that both
// opens a menu on press-and-hold and starts a drag shares four pointer
// handlers, and spreading one object after the other silently drops the first
// of them. Nothing warns about it -- the gesture just stops working.
export function mergeHandlers(...sets) {
  const merged = {}

  for (const set of sets) {
    for (const [name, handler] of Object.entries(set)) {
      const existing = merged[name]
      merged[name] =
        typeof existing === 'function'
          ? (event) => {
              existing(event)
              handler(event)
            }
          : handler
    }
  }

  return merged
}
