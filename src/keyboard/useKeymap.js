import { useMemo, useRef } from 'react'
import { useHotkeys } from '@tanstack/react-hotkeys'

import { KEYMAP } from './keymap.js'

// Registers every binding declared for `scope` that has a matching handler.
// Handlers live in a ref so the definition array stays stable across renders
// while callbacks always see current state.
export function useKeymap(scope, handlers, { enabled = true } = {}) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const handledIds = Object.keys(handlers).sort().join(',')

  const definitions = useMemo(
    () =>
      KEYMAP.filter((binding) => binding.scope === scope && handledIds.split(',').includes(binding.id)).flatMap(
        (binding) =>
          binding.keys.map((hotkey) => ({
            hotkey,
            callback: (event, context) => handlersRef.current[binding.id]?.(event, context),
            options: {
              ...binding.options,
              enabled,
              meta: { name: binding.name, group: binding.group },
            },
          })),
      ),
    [scope, handledIds, enabled],
  )

  useHotkeys(definitions)
}
