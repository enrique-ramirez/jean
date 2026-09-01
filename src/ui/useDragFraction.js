import { useCallback, useRef, useState } from 'react'

import { clamp } from './math.js'

// Spread onto the track with the handlers, covering both ways a browser can
// decide a drag was meant for it rather than for the control.
//
// On a pointer, pressing on a slider and moving starts a *text selection* that
// runs out across whatever is beside it -- and dragging a selection is a native
// drag, so the browser paints a translucent snapshot of the control and follows
// the pointer with that instead of moving the thumb. It looks like the slider
// has come loose, and reads as intermittent because it depends on where the
// press landed and what was already selected.
//
// On touch, the same symptom with a different cause: without `touch-action` the
// browser keeps the gesture for panning, and the moment it decides the finger is
// scrolling it stops sending moves, stranding the thumb wherever it got to.
// `setPointerCapture` does not save this -- capture routes events that still
// exist. And `touch-action` intersects down the tree, which is why it belongs on
// the track rather than on anything containing it.
const GRABBABLE = Object.freeze({
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitUserDrag: 'none',
  touchAction: 'none',
  WebkitTouchCallout: 'none',
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
