import { useCallback, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// Pointer-drag along a horizontal track, reported as 0..1. Shared by the seek
// bar and the volume slider: both need capture, clamping and rect maths, and
// neither should reimplement them.
//
// While dragging, `fraction` is the pointer's position rather than the incoming
// value -- otherwise the thumb fights whatever the player last reported.
export function useDragFraction({ onDrag, onCommit, disabled = false, orientation = 'horizontal' }) {
  const ref = useRef(null)
  const [fraction, setFraction] = useState(null)

  // Vertical is inverted: the top of the track is the maximum, which is what
  // every physical fader does and what people expect from a volume column.
  const read = useCallback(
    (event) => {
      const rect = ref.current.getBoundingClientRect()
      return orientation === 'vertical'
        ? clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
        : clamp((event.clientX - rect.left) / rect.width, 0, 1)
    },
    [orientation],
  )

  const handlers = {
    onPointerDown: (event) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const next = read(event)
      setFraction(next)
      onDrag?.(next)
    },
    onPointerMove: (event) => {
      if (fraction === null) return
      const next = read(event)
      setFraction(next)
      onDrag?.(next)
    },
    onPointerUp: (event) => {
      if (fraction === null) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      onCommit?.(read(event))
      setFraction(null)
    },
    onPointerCancel: () => setFraction(null),
  }

  return { ref, fraction, isDragging: fraction !== null, handlers }
}
