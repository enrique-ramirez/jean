import { useCallback, useMemo } from 'react'

import { FIELD, fieldIsAvailable } from './fields.js'

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
    return fields
  }, [rows])

  const isAvailable = useCallback((field) => available.has(field), [available])

  return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) }
}
