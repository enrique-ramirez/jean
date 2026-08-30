import { useEffect, useMemo, useState } from 'react'

import { fetchPlaylistItems } from '../api/beefweb.js'
import { deriveIntensity } from './intensity.js'

// Chunked rather than one request. Parallel chunks barely beat a single request
// on total time -- the server is the bottleneck -- but the first chunk lands in
// well under a tenth of the total, and rendering it immediately is the whole
// point. The list is usable while the tail is still arriving.
const CHUNK_SIZE = 2000

const cache = new Map()

const cacheKey = (playlistId, itemCount) => `${playlistId}:${itemCount}`

const EMPTY = { rows: [], loaded: 0, total: 0, isLoading: false, error: null }

export function usePlaylistItems(playlistId, itemCount) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    if (!playlistId || itemCount == null) {
      setState(EMPTY)
      return undefined
    }

    const key = cacheKey(playlistId, itemCount)
    const cached = cache.get(key)
    if (cached) {
      setState({ rows: cached, loaded: cached.length, total: cached.length, isLoading: false, error: null })
      return undefined
    }

    const controller = new AbortController()
    let cancelled = false

    setState({ rows: [], loaded: 0, total: itemCount, isLoading: true, error: null })

    const load = async () => {
      const accumulated = []

      try {
        for (let offset = 0; offset < itemCount; offset += CHUNK_SIZE) {
          const chunk = await fetchPlaylistItems(playlistId, offset, CHUNK_SIZE, {
            signal: controller.signal,
          })
          if (cancelled) return

          accumulated.push(...chunk.rows)

          // A fresh array reference each chunk so consumers re-render. Copying
          // 30k pointers a dozen times costs well under a frame in total.
          setState({
            rows: [...accumulated],
            loaded: accumulated.length,
            total: chunk.totalCount,
            isLoading: accumulated.length < chunk.totalCount,
            error: null,
          })

          if (accumulated.length >= chunk.totalCount) break
        }

        if (!cancelled) cache.set(key, accumulated)
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return
        setState((current) => ({ ...current, isLoading: false, error }))
      }
    }

    load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [playlistId, itemCount])

  // Recomputed as chunks land so heat is correct against whatever is loaded.
  // Cheap: two linear passes over typed arrays.
  const intensity = useMemo(() => deriveIntensity(state.rows), [state.rows])

  return { ...state, ...intensity }
}
