import { useCallback, useMemo } from 'react'

import { FIELD, fieldIsAvailable } from './fields.js'
import { hasAnyRating } from './rating.js'

// The capability probe: a field the player cannot resolve returns '?' on every
// row, so what a given install supports is read off the rows themselves rather
// than from a component list we would have to maintain. Sampled once per row
// set rather than per column per render.
export function useAvailableFields(rows) {
  const available = useMemo(() => {
    const fields = new Set()
    for (const field of Object.values(FIELD)) {
      if (fieldIsAvailable(rows, field)) fields.add(field)
    }

    // Rating asks a different question, because the column draws an answer
    // either way. Every other column renders '--' when a track has no value,
    // which is quiet; five empty stars on thirty thousand rows is not, and on a
    // library that has never been rated it states "unrated" thirty thousand
    // times about something the player was never asked. A resolvable field is
    // not enough here -- there has to be a rating in the library somewhere.
    if (!hasAnyRating(rows)) fields.delete(FIELD.rating)

    return fields
  }, [rows])

  const isAvailable = useCallback((field) => available.has(field), [available])

  return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) }
}
