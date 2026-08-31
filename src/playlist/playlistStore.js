import { fetchLibraryItems, fetchPlaylistItems } from '../api/beefweb.js'
import { deriveIntensity } from './intensity.js'

// Measured against a 30,441-track library: a request costs ~270 ms before it
// returns a single row, and only ~30 ms more to return 2,000 rows instead of
// 500. How many requests there are is the whole story; how big they are barely
// registers. Sixteen sequential chunks of 2,000 -- the obvious shape -- took
// 5.5 s.
//
// So: one modest chunk first, purely so something paints, then as few large
// concurrent requests as the browser will run at once. In the browser that is
// first rows at ~730 ms and the whole library loaded in ~1.5 s.
//
// The media library API needs the opposite shape, and the difference is not a
// tuning detail -- it is a different server. *Measured* at 30,441 tracks:
//
//   one request for everything        825 ms
//   4 x 10,000, four at a time      1,198 ms
//   16 x 2,000, four at a time      2,662 ms
//   16 x 2,000, one at a time       2,722 ms
//
// It fits 104 ms fixed per call plus 26 us per item: there is no caching, so
// every call re-enumerates the library and every chunk pays that again.
// Concurrency recovers 2% of it, meaning the work is serialised on the player
// and there is no width to exploit. So: one small chunk to paint, then a single
// request for the remainder. 117 ms to first rows, 920 ms to complete.
const STRATEGY = {
  playlist: { firstChunk: 2500, chunkSize: 7500, concurrency: 4 },
  library: { firstChunk: 500, chunkSize: Infinity, concurrency: 1 },
}

// One shared load per playlist, not one per component. The library playlist is
// ~7 MB raw, and it now has two consumers -- the playlist view and the search
// bar -- which would otherwise each fetch their own copy of it, or fetch it
// twice because neither had finished when the other mounted.
const entries = new Map()

const NO_INTENSITY = { heat: new Float32Array(0), patina: new Float32Array(0), maxPlayCount: 0, playedCount: 0 }

export const EMPTY_PLAYLIST = {
  rows: [],
  paths: null,
  subsongs: null,
  loaded: 0,
  total: 0,
  isLoading: false,
  error: null,
  ...NO_INTENSITY,
}

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
  let entry = entries.get(key)
  if (!entry) {
    entry = { key, listeners: new Set(), snapshot: EMPTY_PLAYLIST, controller: null, isStarted: false }
    entries.set(key, entry)
  }
  return entry
}

function emit(entry, patch) {
  entry.snapshot = { ...entry.snapshot, ...patch }
  for (const listener of entry.listeners) listener()
}

// A playlist that has been edited comes back under a new key. The old copy is
// dead weight -- and at library size that is megabytes -- so it goes, along
// with its in-flight request if it never finished.
function dropSuperseded(playlistId, key) {
  for (const entry of entries.values()) {
    if (entry.key === key || !entry.key.startsWith(`${playlistId}:`)) continue
    if (entry.listeners.size > 0) continue
    entry.controller?.abort()
    entries.delete(entry.key)
  }
}

async function load(entry, source) {
  const { firstChunk, chunkSize, concurrency } = STRATEGY[source.kind]
  const rows = []
  const paths = source.kind === 'library' ? [] : null
  const subsongs = source.kind === 'library' ? [] : null

  const publish = (totalCount, isLoading) => {
    // A fresh array reference each time so consumers re-render. Copying 30k
    // pointers a handful of times costs well under a frame in total.
    const snapshot = [...rows]
    emit(entry, {
      rows: snapshot,
      // Parallel to rows and only present on the library source, where a track
      // has a real identity. Null elsewhere rather than an empty array, so a
      // consumer that reaches for it on the wrong source fails loudly.
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

    const offsets = []
    const remaining = total - rows.length
    // Infinity means "the rest in one request", which is what the library
    // wants: every extra call is another full enumeration.
    const step = Number.isFinite(chunkSize) ? chunkSize : remaining
    for (let offset = rows.length; offset < total; offset += step) offsets.push(offset)

    // Chunks land out of order; rows may only grow in order. Completed chunks
    // wait here until the gap in front of them is filled, so what consumers see
    // is always a prefix of the list rather than one with holes in it.
    const pending = new Map()
    const queue = [...offsets]
    let appended = 0

    const worker = async () => {
      while (queue.length > 0) {
        const offset = queue.shift()
        const chunk = await fetchChunk(source, offset, step, entry.controller.signal)
        pending.set(offset, chunk)

        while (appended < offsets.length && pending.has(offsets[appended])) {
          absorb(pending.get(offsets[appended]))
          pending.delete(offsets[appended])
          appended += 1
        }

        publish(total, rows.length < total)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, worker),
    )

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

// Loads run to completion even if every consumer unmounts. Abandoning a
// half-loaded library so the next visit restarts from zero is the worse trade:
// the bytes are already paid for, and the rows are what search reads.
export function loadPlaylist(playlistId, itemCount) {
  return begin(playlistKey(playlistId, itemCount), playlistId, itemCount, {
    kind: 'playlist',
    playlistId,
  })
}

export function loadLibrary(itemCount) {
  return begin(libraryKey(itemCount), 'library', itemCount, { kind: 'library' })
}

function begin(key, dropPrefix, itemCount, source) {
  const entry = entryFor(key)
  if (entry.isStarted) return key

  entry.isStarted = true
  entry.controller = new AbortController()
  dropSuperseded(dropPrefix, key)

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
