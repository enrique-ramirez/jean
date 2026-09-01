import { useCallback, useEffect, useRef } from 'react'

const HOLD_MS = 420
// How far the finger may wander and still count as a hold. Much tighter than
// this and it fires on the tremor of holding a phone one-handed.
const SLOP_PX = 10

// Touch has no second mouse button, so press-and-hold stands in for a
// right-click. Two things have to be true for it to feel right: a hold that
// turns into a scroll must not fire, and the tap the browser synthesises when
// the finger lifts must not reach whatever was underneath.
//
// The browser is a willing partner on the first -- the moment it decides the
// gesture is a scroll it claims the pointer and fires pointercancel -- so the
// slop check only covers the window before it makes up its mind.
//
// Spread `style` onto the pressable element, or iOS puts its own selection
// callout over the menu.
const PRESSABLE = Object.freeze({
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
})

export function useLongPress(onLongPress, { enabled = true, holdMs = HOLD_MS } = {}) {
  const timer = useRef(null)
  const echoTimer = useRef(null)
  const origin = useRef(null)
  // Set while the synthetic click and (on Android) the native contextmenu are
  // still on their way. Both are echoes of a gesture we have already answered.
  const justFired = useRef(false)
  const latest = useRef(onLongPress)
  latest.current = onLongPress

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(echoTimer.current)
    },
    [],
  )

  const onPointerDown = (event) => {
    // Mouse and trackpad have contextmenu; holding one down should do nothing.
    if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return

    cancel()
    justFired.current = false
    const point = { x: event.clientX, y: event.clientY }
    origin.current = point

    timer.current = setTimeout(() => {
      timer.current = null
      origin.current = null
      justFired.current = true
      // Time-boxed rather than cleared by the handlers: which echoes actually
      // arrive differs by platform -- Android suppresses the click once it has
      // fired contextmenu, iOS sends the click and no contextmenu -- so waiting
      // for a specific one to arrive leaves the guard stuck on.
      clearTimeout(echoTimer.current)
      echoTimer.current = setTimeout(() => {
        justFired.current = false
      }, 700)
      // The only feedback that the hold registered before the menu paints.
      // Without it the delay reads as the app being slow.
      navigator.vibrate?.(8)
      latest.current(point)
    }, holdMs)
  }

  const onPointerMove = (event) => {
    if (!origin.current) return
    const dx = event.clientX - origin.current.x
    const dy = event.clientY - origin.current.y
    if (Math.hypot(dx, dy) > SLOP_PX) cancel()
  }

  return {
    style: PRESSABLE,
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,

    onClickCapture: (event) => {
      if (!justFired.current) return
      event.preventDefault()
      event.stopPropagation()
    },

    // Android fires a real contextmenu about half a second into a hold, which
    // would arrive just after ours and reopen the menu somewhere else.
    onContextMenuCapture: (event) => {
      if (!justFired.current) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
