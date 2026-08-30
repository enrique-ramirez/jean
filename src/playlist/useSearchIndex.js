import { useMemo } from 'react'

import { FIELD, value } from './fields.js'

const MAX_RESULTS = 60

// One lowercased haystack per row so a keystroke costs a single includes() call
// instead of three case conversions. That is one extra per-track-unique string,
// which is exactly what the loading rules say to avoid -- so it is built lazily,
// only once the user actually opens a finder, and dropped with the playlist.
export function useSearchIndex(rows, enabled) {
  return useMemo(() => {
    if (!enabled) return null

    const haystacks = new Array(rows.length)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      haystacks[index] = [
        value(row, FIELD.title),
        value(row, FIELD.artist),
        value(row, FIELD.album),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    }
    return haystacks
  }, [rows, enabled])
}

// Returns every matching index for highlighting in place, plus a capped list to
// render in the dropdown. The list is never filtered down -- finding a track
// must not change what the playlist is.
export function search(haystacks, query) {
  if (!haystacks || query.trim().length === 0) return { matches: null, results: [] }

  const needle = query.trim().toLowerCase()
  const matches = new Set()
  const results = []

  for (let index = 0; index < haystacks.length; index += 1) {
    if (!haystacks[index].includes(needle)) continue
    matches.add(index)
    if (results.length < MAX_RESULTS) results.push(index)
  }

  return { matches, results }
}
