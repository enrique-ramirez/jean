// Native `loading="lazy"` asks the wrong question. It fires the moment a row is
// near the viewport, and a virtualised list moves rows through the viewport by
// the hundred: *measured*, one jump to the playing track across a 30,441-row
// playlist started **499 artwork requests** for a screen that comes to rest
// showing 41. The other 458 covers existed for a frame and nobody saw them.
//
// What that costs is not frames, it is the rest of the app. Nothing blocks the
// main thread -- measured, zero long tasks for the whole flight -- which is
// exactly why it reads as the player ignoring you rather than as jank. The
// browser gives an origin six HTTP/1.1 connections, the update stream holds one
// of them open forever, and everything Jean asks for afterwards queues behind
// covers for rows that are long gone. Against a player taking 200 ms a cover, a
// play/pause pressed a second and a half after the jump waited **122 ms** for a
// socket, and the queue drained for **19.8 s**. A real foobar2000 is the slow
// case rather than the fast one: it extracts embedded art per request, where the
// fake serves a file.
//
// So a cover is not requested when it becomes visible. It is requested when its
// turn comes, and only if it is still on screen by then. Two parts, and the
// first is the one that does the work:
//
// - A row has to still be mounted a moment after it appeared before it is even
//   queued. A queue on its own is worse than nothing -- against a player that
//   answers instantly it drains as fast as the rows churn and lets every one of
//   them through, measured at 1,115 requests, *more* than the native behaviour
//   it replaced. Time is the gate; capacity only shapes what gets through it.
// - The queue then only ever holds rows that are currently mounted, because
//   leaving the screen removes the entry. So it is FIFO rather than
//   newest-first: the order is mount order, and a settled screen fills
//   top-down.
//
// The same jump now costs 41 requests, one per row on screen.
//
// A row scrolled past lives one or two frames. Deliberate scrolling leaves rows
// on screen for far longer than this, so covers still stream in as you go.
const SETTLE_MS = 100

// Six connections, one of them permanently the update stream, so this leaves two
// for everything else. A cover is never worth a transport command's socket.
const MAX_IN_FLIGHT = 3

const waiting = []
let inFlight = 0

// What the browser has already been told about a cover, and it is worth
// remembering both answers. A row scrolled back over must not queue for
// something already in the cache -- that is a visible flash on every reversal of
// direction, in exchange for no request at all -- and a track with no embedded
// art must not ask again every time it comes back, which on a library that is
// mostly uncovered is most of the requests in the list.
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
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const entry = waiting.shift()
    inFlight += 1
    entry.grant()
  }
}

// Returns the release. Call it with `'ok'` or `'failed'` once the image has
// settled, and with nothing when the row goes away before that -- in which case
// the caller has to stop the request itself, because a slot released while the
// socket is still busy would let this run wider than the cap it exists to hold.
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
