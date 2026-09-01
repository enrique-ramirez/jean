// Native `loading="lazy"` asks the wrong question. It fires the moment a row is
// near the viewport, and a virtualised list moves rows through the viewport by
// the hundred -- so one jump across a long playlist starts a cover request for
// every row it passed, for a screen that comes to rest showing forty.
//
// What that costs is not frames, it is the rest of the app: nothing blocks the
// main thread, which is why it reads as the player ignoring you rather than as
// jank. The browser gives an origin six HTTP/1.1 connections, the update stream
// holds one open forever, and everything Jean asks for afterwards queues behind
// covers for rows that are long gone.
//
// So a cover is requested when its turn comes, and only if it is still on
// screen by then. **Time is the gate; capacity only shapes what gets through
// it** -- a queue on its own is worse than nothing, because against a player
// that answers instantly it drains as fast as the rows churn and lets every one
// of them through.

// How long a row has to stay mounted before it is even queued. A row scrolled
// past lives one or two frames; deliberate scrolling leaves them far longer, so
// covers still stream in as you go.
const SETTLE_MS = 100

// Six connections, one permanently the update stream, so this leaves two for
// everything else. A cover is never worth a transport command's socket.
const MAX_IN_FLIGHT = 3

const waiting = []
let inFlight = 0

// What the browser has already been told about a cover, and both answers are
// worth remembering. A row scrolled back over must not queue for something
// already cached -- that is a visible flash on every reversal of direction, for
// no request at all -- and a track with no embedded art must not ask again
// every time it comes back, which on a mostly uncovered library is most of the
// traffic in the list.
const SEEN_LIMIT = 4096
let seen = new Map()

export const outcomeFor = (url) => seen.get(url)

const remember = (url, outcome) => {
  // Forgetting the lot costs one trip through the queue, never a refetch: the
  // browser still has the image. Cheaper than an LRU for something whose only
  // job is to stop a flash.
  if (seen.size >= SEEN_LIMIT) seen = new Map()
  seen.set(url, outcome)
}

const pump = () => {
  const starting = waiting.splice(0, MAX_IN_FLIGHT - inFlight)
  inFlight += starting.length
  starting.forEach((entry) => entry.grant())
}

// Returns the release. Call it with `'ok'` or `'failed'` once the image has
// settled, and with nothing when the row goes away first -- in which case the
// caller has to stop the request itself, because a slot released while the
// socket is still busy would let this run wider than its cap.
export function requestArtwork(url, grant) {
  const entry = { url, grant, released: false, pending: 0 }

  entry.pending = setTimeout(() => {
    entry.pending = 0
    waiting.push(entry)
    pump()
  }, SETTLE_MS)

  return (outcome) => {
    if (entry.released) return
    entry.released = true
    if (outcome) remember(url, outcome)

    if (entry.pending) {
      clearTimeout(entry.pending)
      entry.pending = 0
      return
    }

    const queued = waiting.indexOf(entry)
    if (queued >= 0) {
      waiting.splice(queued, 1)
      return
    }

    inFlight -= 1
    pump()
  }
}
