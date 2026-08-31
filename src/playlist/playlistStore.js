import { fetchPlaylistItems } from '../api/beefweb.js'
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
const FIRST_CHUNK = 2500
const CHUNK_SIZE = 7500
// Six connections per host on HTTP/1.1, and the SSE stream is holding one.
const CONCURRENCY = 4

// One shared load per playlist, not one per component. The library playlist is
// ~7 MB raw, and it now has two consumers -- the playlist view and the search
// bar -- which would otherwise each fetch their own copy of it, or fetch it
// twice because neither had finished when the other mounted.
const entries = new Map()

const NO_INTENSITY = { heat: new Float32Array(0), patina: new Float32Array(0), maxPlayCount: 0, playedCount: 0 }

export const EMPTY_PLAYLIST = {
  rows: [],
  loaded: 0,
  total: 0,
  isLoading: false,
  error: null,
  ...NO_INTENSITY,
}

export const playlistKey = (playlistId, itemCount) => `${playlistId}:${itemCount}`

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

async function load(entry, playlistId, itemCount) {
  const rows = []

  const publish = (totalCount, isLoading) => {
    // A fresh array reference each time so consumers re-render. Copying 30k
    // pointers a handful of times costs well under a frame in total.
    const snapshot = [...rows]
    emit(entry, {
      rows: snapshot,
      loaded: snapshot.length,
      total: totalCount,
      isLoading,
      error: null,
      ...deriveIntensity(snapshot),
    })
  }

  try {
    const first = await fetchPlaylistItems(playlistId, 0, FIRST_CHUNK, { signal: entry.controller.signal })
    rows.push(...first.rows)

    const total = first.totalCount
    publish(total, rows.length < total)
    if (rows.length >= total) return

    const offsets = []
    for (let offset = rows.length; offset < total; offset += CHUNK_SIZE) offsets.push(offset)

    // Chunks land out of order; rows may only grow in order. Completed chunks
    // wait here until the gap in front of them is filled, so what consumers see
    // is always a prefix of the playlist rather than a list with holes in it.
    const pending = new Map()
    const queue = [...offsets]
    let appended = 0

    const worker = async () => {
      while (queue.length > 0) {
        const offset = queue.shift()
        const chunk = await fetchPlaylistItems(playlistId, offset, CHUNK_SIZE, {
          signal: entry.controller.signal,
        })
        pending.set(offset, chunk.rows)

        while (appended < offsets.length && pending.has(offsets[appended])) {
          rows.push(...pending.get(offsets[appended]))
          pending.delete(offsets[appended])
          appended += 1
        }

        publish(total, rows.length < total)
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

    // The playlist can be shorter than it claimed -- it may have been edited
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
  const key = playlistKey(playlistId, itemCount)
  const entry = entryFor(key)
  if (entry.isStarted) return key

  entry.isStarted = true
  entry.controller = new AbortController()
  dropSuperseded(playlistId, key)

  emit(entry, { total: itemCount, isLoading: itemCount > 0, error: null })
  if (itemCount > 0) load(entry, playlistId, itemCount)

  return key
}

export function subscribePlaylist(key, listener) {
  const entry = entryFor(key)
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

export const playlistSnapshot = (key) => entries.get(key)?.snapshot ?? EMPTY_PLAYLIST
