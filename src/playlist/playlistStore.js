import { fetchLibraryItems, fetchPlaylistItems } from '../api/beefweb.js'
import { deriveIntensity } from './intensity.js'

// Two servers with opposite costs, so two shapes. Count the requests, not the
// rows: on a playlist almost all the cost is the round trip and hardly any of
// it is the size, so one modest chunk to paint and then as few large concurrent
// ones as the browser will run. The media library endpoint has no cache, so
// every call re-enumerates the whole library and concurrency buys nothing --
// one small chunk to paint, then a single request for the rest.
const STRATEGY = {
  playlist: { firstChunk: 2500, chunkSize: 7500, concurrency: 4 },
  library: { firstChunk: 500, chunkSize: Infinity, concurrency: 1 },
}

// One shared load per key, not one per component: the library has several
// consumers, which would otherwise each fetch their own copy of it.
//
// A load runs to completion even after every consumer unmounts -- the bytes are
// already paid for, and abandoning a half-loaded library so the next visit
// starts from zero is the worse trade. But rows are the largest thing Jean
// holds, so what is kept afterwards is bounded: this many unwatched entries,
// beyond which the least recently used go. Unbounded, browsing twenty playlists
// retains twenty copies for the life of the tab.
const MAX_IDLE_ENTRIES = 4

const entries = new Map()

export const EMPTY_PLAYLIST = Object.freeze({
  rows: [],
  paths: null,
  subsongs: null,
  loaded: 0,
  total: 0,
  isLoading: false,
  error: null,
  heat: new Float32Array(0),
  patina: new Float32Array(0),
  playedCount: 0,
})

export const playlistKey = (playlistId, itemCount) => `${playlistId}:${itemCount}`

// The media library is not a playlist and has no id, so it gets a key of its
// own -- still carrying the count, so an edited library loads afresh rather
// than inheriting rows that have moved.
export const libraryKey = (itemCount) => `library:${itemCount}`

// One shape for both, so the loading machinery below never asks which it is.
// `paths` and `subsongs` are null for a playlist, which has neither.
const fetchChunk = async (source, offset, count, signal) => {
  if (source.kind === 'playlist') {
    const chunk = await fetchPlaylistItems(source.playlistId, offset, count, { signal })
    return { rows: chunk.rows, totalCount: chunk.totalCount, paths: null, subsongs: null }
  }

  const chunk = await fetchLibraryItems({ offset, count, signal })
  return {
    rows: chunk.items.map((item) => item.columns),
    totalCount: chunk.totalCount,
    paths: chunk.items.map((item) => item.path),
    subsongs: chunk.items.map((item) => item.subsong ?? 0),
  }
}

function entryFor(key) {
  const held = entries.get(key)
  if (held) {
    // Re-inserted so the eviction below sees it as the most recent.
    entries.delete(key)
    entries.set(key, held)
    return held
  }

  const entry = { key, listeners: new Set(), snapshot: EMPTY_PLAYLIST, controller: null, isStarted: false }
  entries.set(key, entry)
  return entry
}

function emit(entry, patch) {
  entry.snapshot = { ...entry.snapshot, ...patch }
  entry.listeners.forEach((listener) => listener())
}

const prefixOf = (key) => key.slice(0, key.indexOf(':'))

// Two reasons to let an entry go, and both need nobody watching it. A
// *superseded* one -- same playlist, different item count -- is a stale copy of
// the largest thing in memory and can never be wanted again, so it always goes.
// The rest are merely old, and insertion order is recency. An entry still
// loading is aborted with it: nobody is waiting for those bytes.
function evictIdle(currentKey) {
  const idle = [...entries.values()].filter(
    (entry) => entry.key !== currentKey && entry.listeners.size === 0,
  )

  const kept = new Set(
    idle.filter((entry) => prefixOf(entry.key) !== prefixOf(currentKey)).slice(-MAX_IDLE_ENTRIES),
  )

  idle
    .filter((entry) => !kept.has(entry))
    .forEach((entry) => {
      entry.controller?.abort()
      entries.delete(entry.key)
    })
}

async function load(entry, source) {
  const { firstChunk, chunkSize, concurrency } = STRATEGY[source.kind]
  const isLibrary = source.kind === 'library'

  const rows = []
  const paths = isLibrary ? [] : null
  const subsongs = isLibrary ? [] : null

  const publish = (totalCount, isLoading) => {
    // A fresh array reference each time, so consumers re-render.
    const snapshot = [...rows]
    emit(entry, {
      rows: snapshot,
      // Parallel to rows and only present on the library source, where a track
      // has a real identity. Null elsewhere rather than empty, so a consumer
      // reaching for it on the wrong source fails loudly.
      paths: paths ? [...paths] : null,
      subsongs: subsongs ? [...subsongs] : null,
      loaded: snapshot.length,
      total: totalCount,
      isLoading,
      error: null,
      ...deriveIntensity(snapshot),
    })
  }

  const absorb = (chunk) => {
    rows.push(...chunk.rows)
    if (paths) paths.push(...chunk.paths)
    if (subsongs) subsongs.push(...chunk.subsongs)
  }

  try {
    const first = await fetchChunk(source, 0, firstChunk, entry.controller.signal)
    absorb(first)

    const total = first.totalCount
    publish(total, rows.length < total)
    if (rows.length >= total) return

    // Infinity means "the rest in one request", which is what the library
    // wants: every extra call is another full enumeration.
    const step = Number.isFinite(chunkSize) ? chunkSize : total - rows.length
    const offsets = Array.from(
      { length: Math.ceil((total - rows.length) / step) },
      (_, at) => rows.length + at * step,
    )

    // Chunks land out of order; rows may only grow in order. A completed chunk
    // waits here until the gap in front of it is filled, so what consumers see
    // is always a prefix of the list rather than one with holes in it.
    const pending = new Map()
    const queue = [...offsets]
    let appended = 0

    const drainInOrder = () => {
      while (appended < offsets.length && pending.has(offsets[appended])) {
        absorb(pending.get(offsets[appended]))
        pending.delete(offsets[appended])
        appended += 1
      }
    }

    const worker = async () => {
      while (queue.length > 0) {
        const offset = queue.shift()
        pending.set(offset, await fetchChunk(source, offset, step, entry.controller.signal))
        drainInOrder()
        publish(total, rows.length < total)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

    // The list can be shorter than it claimed -- it may have been edited
    // between the first chunk and the last -- so loading ends here, not when
    // the count is reached.
    publish(total, false)
  } catch (error) {
    if (error.name === 'AbortError') return
    // Cleared so a later mount can try again rather than sitting on the failure
    // for as long as the tab is open.
    entry.isStarted = false
    emit(entry, { isLoading: false, error })
  }
}

export const loadPlaylist = (playlistId, itemCount) =>
  begin(playlistKey(playlistId, itemCount), itemCount, { kind: 'playlist', playlistId })

export const loadLibrary = (itemCount) => begin(libraryKey(itemCount), itemCount, { kind: 'library' })

function begin(key, itemCount, source) {
  const entry = entryFor(key)
  if (entry.isStarted) return key

  entry.isStarted = true
  entry.controller = new AbortController()
  evictIdle(key)

  emit(entry, { total: itemCount, isLoading: itemCount > 0, error: null })
  if (itemCount > 0) load(entry, source)

  return key
}

export function subscribePlaylist(key, listener) {
  const entry = entryFor(key)
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

export const playlistSnapshot = (key) => entries.get(key)?.snapshot ?? EMPTY_PLAYLIST
