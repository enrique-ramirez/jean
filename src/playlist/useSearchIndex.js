import { useMemo } from 'react'

import { matchesTokens, tokenize } from '../ui/text.js'
import { rowHaystack } from './searchText.js'

const MAX_RESULTS = 60

// Built lazily -- only once somebody opens a finder -- and dropped with the
// playlist it was built for.
export function useSearchIndex(rows, enabled) {
  return useMemo(() => (enabled ? rows.map(rowHaystack) : null), [rows, enabled])
}

// Every match, for highlighting in place, plus a capped list to render in the
// dropdown. The list is never filtered down: finding a track must not change
// what the playlist is.
export function search(haystacks, query) {
  const tokens = tokenize(query)
  if (!haystacks || tokens.length === 0) return { matches: null, results: [] }

  const matches = new Set(
    haystacks.flatMap((haystack, index) => (matchesTokens(haystack, tokens) ? index : [])),
  )

  return { matches, results: [...matches].slice(0, MAX_RESULTS) }
}
