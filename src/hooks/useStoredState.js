import { useCallback, useState } from 'react'

// Local for now. These are exactly the values that should end up in beefweb's
// /api/clientconfig so they follow the user between devices — the signature is
// deliberately the same shape a server-backed version would have.
const resolve = (fallback) => (typeof fallback === 'function' ? fallback() : fallback)

const read = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? resolve(fallback) : JSON.parse(stored)
  } catch {
    return resolve(fallback)
  }
}

export function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => read(key, fallback))

  const update = useCallback(
    (next) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? next(current) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // Private mode, quota — the setting just does not persist.
        }
        return resolved
      })
    },
    [key],
  )

  return [value, update]
}
