import { useSyncExternalStore } from 'react'

const subscribe = (query) => (onChange) => {
  const list = window.matchMedia(query)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

export function useMediaQuery(query) {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export const useIsCompactViewport = () => useMediaQuery('(max-width: 860px)')
