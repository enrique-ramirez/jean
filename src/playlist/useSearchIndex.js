import { useMemo } from 'react'

import { haystackMatches, rowHaystack, tokenize } from './searchText.js'

const MAX_RESULTS = 60

// Built lazily -- only once the user actually opens a finder -- and dropped
// with the playlist.
export function useSearchIndex(rows, enabled) {
  return useMemo(() => {
    if (!enabled) return null

    const haystacks = new Array(rows.length)
    for (let index = 0; index < rows.length; index += 1) haystacks[index] = rowHaystack(rows[index])
    return haystacks
  }, [rows, enabled])
}

// Returns every matching index for highlighting in place, plus a capped list to
// render in the dropdown. The list is never filtered down -- finding a track
// must not change what the playlist is.
export function search(haystacks, query) {
  const tokens = tokenize(query)
  if (!haystacks || tokens.length === 0) return { matches: null, results: [] }

  const matches = new Set()
  const results = []

  for (let index = 0; index < haystacks.length; index += 1) {
    if (!haystackMatches(haystacks[index], tokens)) continue
    matches.add(index)
    if (results.length < MAX_RESULTS) results.push(index)
  }

  return { matches, results }
}
