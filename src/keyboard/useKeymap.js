import { useMemo, useRef } from 'react'
import { useHotkeys } from '@tanstack/react-hotkeys'

import { KEYMAP } from './keymap.js'

// Registers every binding declared for `scope` that has a matching handler.
// Handlers live in a ref so the definition array stays stable across renders
// while callbacks always see current state; `handledIds` is the memo's
// dependency for the same reason -- a fresh handlers object every render would
// re-register every binding every time.
export function useKeymap(scope, handlers, { enabled = true } = {}) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const handledIds = Object.keys(handlers).sort().join(',')

  const definitions = useMemo(() => {
    const handled = new Set(handledIds.split(','))

    return KEYMAP.filter(
      (binding) => binding.scope === scope && handled.has(binding.id),
    ).flatMap((binding) =>
      binding.keys.map((hotkey) => ({
        hotkey,
        callback: (event, context) => handlersRef.current[binding.id]?.(event, context),
        options: {
          ...binding.options,
          enabled,
          meta: { name: binding.name, group: binding.group },
        },
      })),
    )
  }, [scope, handledIds, enabled])

  useHotkeys(definitions)
}
