import { useEffect } from 'react'

import { useStoredState } from '../hooks/useStoredState.js'

const systemPreference = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'

export function useTheme() {
  const [theme, setTheme] = useStoredState('jean.theme', systemPreference)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))

  return { theme, toggle }
}
