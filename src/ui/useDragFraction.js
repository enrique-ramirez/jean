import { useCallback, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// Spread onto the track along with the handlers. Without it, pressing on a
// slider and moving starts a *text selection* that runs out across whatever is
// beside it, and dragging a selection is a native drag -- so the browser paints
// a translucent snapshot of the control and follows the pointer with it instead
// of moving the thumb. It looks like the slider has come loose.
//
// It reads as intermittent because it depends on where the press lands and what
// was already selected, which is what makes it easy to dismiss as a glitch.
const GRABBABLE = Object.freeze({
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitUserDrag: 'none',
})

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
    style: GRABBABLE,

    // Belt to the CSS braces: states the guarantee outright rather than leaving
    // it to hold as a consequence of nothing being selectable.
    onDragStart: (event) => event.preventDefault(),

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
