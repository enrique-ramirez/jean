import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

// Dragging something out of one scroll container and onto a target in another.
//
// Deliberately not built on useSortableList: that reorders one list, where the
// dragged element stays mounted and the drop position is arithmetic. Here the
// source row can be unmounted by the virtualiser mid-gesture and the target is
// elsewhere in the tree entirely, so the drop is hit-tested against the
// document and what follows the pointer is a ghost rather than the row.
//
// Three rules hold it together:
//
//  - **No pointer capture.** Capture retargets every later event to the
//    capturing element, so a handler on a *descendant* never fires again -- and
//    the natural capture element is the scroll container, an ancestor of the
//    rows. Window listeners for the length of the gesture have no such ambiguity.
//  - **The store carries only coarse facts** -- dragging or not, which target is
//    armed -- so subscribing is free. The track list does not subscribe at all
//    and must never re-render during a drag.
//  - **The ghost is moved imperatively**, because position is the one thing that
//    changes every frame.

const THRESHOLD_PX = 5
const AUTOSCROLL_ZONE_PX = 52
const AUTOSCROLL_MAX_PX = 13
// Below and right of the cursor, so the ghost never covers the row the pointer
// is actually over -- which is the row being hit-tested.
const GHOST_OFFSET = { x: 18, y: 16 }

const IDLE = { isDragging: false, over: null, count: 0, label: null }

let state = IDLE
let ghostElement = null
const listeners = new Set()

const publish = (next) => {
  state = next
  listeners.forEach((listener) => listener())
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => state

export const useDragState = () => useSyncExternalStore(subscribe, snapshot, snapshot)

// Held outside React because it is written every frame. See the note above.
export const setGhostElement = (element) => {
  ghostElement = element
}

// The pointer is going to travel over selectable text in another container, and
// a drag that started somewhere with user-select: none can still select it on
// the way past. Cheaper to hold the whole document still for the gesture.
const setDocumentDragging = (on) => {
  document.body.style.userSelect = on ? 'none' : ''
  document.body.style.cursor = on ? 'grabbing' : ''
}

const placeGhost = (x, y) => {
  if (!ghostElement) return
  ghostElement.style.transform = `translate3d(${x + GHOST_OFFSET.x}px, ${y + GHOST_OFFSET.y}px, 0)`
}

// The ghost is pointer-events: none, so it never shadows what is underneath.
const targetUnder = (x, y, canDrop) => {
  const element = document.elementFromPoint(x, y)?.closest('[data-drop-target]')
  const id = element?.dataset.dropTarget
  if (!id || (canDrop && !canDrop(id))) return null
  return id
}

// Any marked scroller under the pointer follows the drag, so a target below the
// fold of a long sidebar is still reachable without letting go.
const autoscroll = (x, y) => {
  const scroller = document.elementFromPoint(x, y)?.closest('[data-drop-scroller]')
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return

  const rect = scroller.getBoundingClientRect()
  const above = y - rect.top
  const below = rect.bottom - y

  if (above < AUTOSCROLL_ZONE_PX) {
    scroller.scrollTop -= AUTOSCROLL_MAX_PX * (1 - above / AUTOSCROLL_ZONE_PX)
  } else if (below < AUTOSCROLL_ZONE_PX) {
    scroller.scrollTop += AUTOSCROLL_MAX_PX * (1 - below / AUTOSCROLL_ZONE_PX)
  }
}

// `getPayload` returns { items, label, count } for the row the gesture started
// on, or null to leave the pointer alone. `canDrop` filters targets by id.
export function useDragSource({ getPayload, canDrop, onDrop, disabled = false }) {
  const gesture = useRef(null)
  const frame = useRef(null)
  // True from the moment a drag starts until the next pointer-down, so a caller
  // can tell a drag from a click after the fact -- selection has to know.
  const dragged = useRef(false)

  const latest = useRef({ getPayload, canDrop, onDrop })
  latest.current = { getPayload, canDrop, onDrop }

  const teardown = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = null
    window.removeEventListener('pointermove', gesture.current?.onMove)
    window.removeEventListener('pointerup', gesture.current?.onUp)
    window.removeEventListener('pointercancel', gesture.current?.onCancel)
    gesture.current = null
  }, [])

  useEffect(() => teardown, [teardown])

  // Hit-testing on a frame rather than on the move event, so a target that
  // scrolls under a stationary pointer still arms.
  const tick = useCallback(() => {
    const current = gesture.current
    if (!current?.started) return

    const { x, y } = current.pointer
    placeGhost(x, y)
    autoscroll(x, y)

    const over = targetUnder(x, y, latest.current.canDrop)
    if (over !== state.over) publish({ ...state, over })

    frame.current = requestAnimationFrame(tick)
  }, [])

  const onPointerDown = (event) => {
    // Touch is not a drag surface here: the sidebar is a drawer that covers the
    // list, so there is nothing to drag onto. The menu is the path there.
    if (disabled || event.pointerType !== 'mouse' || event.button !== 0) return

    dragged.current = false

    const payload = latest.current.getPayload(event)
    if (!payload) return

    const current = {
      startX: event.clientX,
      startY: event.clientY,
      pointer: { x: event.clientX, y: event.clientY },
      payload,
      started: false,
    }

    current.onMove = (moveEvent) => {
      current.pointer = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (current.started) return
      if (Math.hypot(moveEvent.clientX - current.startX, moveEvent.clientY - current.startY) < THRESHOLD_PX) return

      current.started = true
      dragged.current = true
      setDocumentDragging(true)
      // Placed before the first paint of the ghost, or it appears at the origin
      // for one frame before catching up.
      placeGhost(current.pointer.x, current.pointer.y)
      publish({ isDragging: true, over: null, count: payload.count, label: payload.label })
      frame.current = requestAnimationFrame(tick)
    }

    current.onUp = () => {
      const { started } = current
      const over = state.over
      teardown()
      if (!started) return
      setDocumentDragging(false)
      publish(IDLE)
      if (over) latest.current.onDrop(over, payload)
    }

    current.onCancel = () => {
      const { started } = current
      teardown()
      if (!started) return
      setDocumentDragging(false)
      publish(IDLE)
    }

    gesture.current = current
    window.addEventListener('pointermove', current.onMove)
    window.addEventListener('pointerup', current.onUp)
    window.addEventListener('pointercancel', current.onCancel)
  }

  return { dragProps: { onPointerDown }, didDrag: () => dragged.current }
}
