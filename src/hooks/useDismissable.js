import { useEffect, useRef } from 'react'

// Closes a popover on outside pointer-down or Escape. Returns the ref to put on
// the popover's containing element (trigger included, so clicking the trigger
// again toggles rather than closing-then-reopening).
export function useDismissable(isOpen, onDismiss) {
  const ref = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onDismiss()
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onDismiss()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, onDismiss])

  return ref
}
