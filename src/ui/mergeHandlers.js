// Composes several sets of React event props onto one element, running every
// handler registered for a name in the order given.
//
// Needed the moment two behaviours listen to the same element: a row that both
// opens a menu on press-and-hold and starts a drag shares four pointer
// handlers, and spreading one object after the other silently drops the first.
// Nothing warns about it -- the gesture just stops working.
export const mergeHandlers = (...sets) =>
  sets.reduce(
    (merged, set) =>
      Object.entries(set).reduce((into, [name, handler]) => {
        const existing = into[name]
        return {
          ...into,
          [name]:
            typeof existing === 'function'
              ? (event) => {
                  existing(event)
                  handler(event)
                }
              : handler,
        }
      }, merged),
    {},
  )
