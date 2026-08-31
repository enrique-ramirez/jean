import { useCallback, useEffect, useRef, useState } from 'react'

// Reordering a short list by dragging it. Pointer events rather than HTML5
// drag-and-drop: one implementation covers mouse and touch, the dragged row is
// a real element instead of a screenshot of one, and nothing is left to the
// browser's idea of a drop shadow.
//
// Rows are measured once, on drag start. A list you can reorder by hand is a
// list you can see all of, so this stays cheap -- and it means variable row
// heights work without a special case: an item shifts by the gap between the
// two rows it is swapping with, not by a height assumed to be uniform.
//
// `keys` is the current order, as stable ids. It is what tells the drop when it
// is over: the transforms are held at their landing positions until the caller
// has actually reordered the list, so the row never flicks back to where it
// started for the frame between letting go and the new order arriving.

// Far enough that a click is never mistaken for a drag. The mouse number is
// generous for its input device on purpose: the row body is both the drag
// target and a navigation control, and a click that wanders should not quietly
// rewrite the order. Touch is stricter again -- a finger moves a few pixels
// just being lifted.
const THRESHOLD_PX = { mouse: 6, touch: 8 }
// How close to the edge of the scroller before it starts following the drag.
const AUTOSCROLL_ZONE_PX = 56
const AUTOSCROLL_MAX_PX = 14
// If the reorder never lands -- the player refused it -- stop holding the
// transforms rather than freezing the list in place.
const SETTLE_TIMEOUT_MS = 600

// Where the dragged row ends up once the list is reordered. Going down it takes
// the slot the target row vacates, which has to be measured from that row's
// *bottom*: with rows of different heights the tops do not line up.
const landingOffset = ({ tops, from, to }) => {
  if (to > from) return tops[to].top + tops[to].height - tops[from].height - tops[from].top
  return tops[to].top - tops[from].top
}

export function useSortableList({ keys, onReorder, disabled = false }) {
  const order = keys.join(' ')
  const scrollRef = useRef(null)
  const itemRefs = useRef([])
  const refCallbacks = useRef([])
  const drag = useRef(null)
  const frame = useRef(null)
  const settledAt = useRef(null)
  // A mouse drag that starts on the row ends with a click on the row, and the
  // row is a link. Without swallowing it, reordering a playlist also navigates
  // to it. The grip never had this problem: it is not inside the button.
  const justDragged = useRef(false)

  // Position is state, not a ref: the rows have to re-render to follow. It is
  // one small list, and the alternative -- writing transforms imperatively --
  // fights React over the same style attribute the drop then has to clear.
  const [state, setState] = useState(null)

  // Cached per index. A fresh closure every render would detach and reattach
  // every row's ref on every pointer move.
  const setItemRef = (index) => {
    refCallbacks.current[index] ??= (element) => {
      itemRefs.current[index] = element
    }
    return refCallbacks.current[index]
  }

  const stopAutoscroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  useEffect(() => stopAutoscroll, [stopAutoscroll])

  useEffect(() => {
    if (!state?.settled) return undefined
    if (order !== settledAt.current) {
      setState(null)
      return undefined
    }
    const timer = setTimeout(() => setState(null), SETTLE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [state, order])

  // Which index the dragged row would land on, compared against the midpoint of
  // each resting row -- so the swap happens when they visually cross rather
  // than when they merely touch.
  const targetFor = ({ tops, from }, offset) => {
    const centre = tops[from].top + offset + tops[from].height / 2

    let target = from
    for (let index = 0; index < tops.length; index += 1) {
      if (index === from) continue
      const row = tops[index]
      if (index < from && centre < row.top + row.height / 2) return index
      if (index > from && centre > row.top + row.height / 2) target = index
    }
    return target
  }

  const autoscroll = (clientY) => {
    const scroller = scrollRef.current
    if (!scroller) return

    const rect = scroller.getBoundingClientRect()
    const above = clientY - rect.top
    const below = rect.bottom - clientY

    let step = 0
    if (above < AUTOSCROLL_ZONE_PX) step = -AUTOSCROLL_MAX_PX * (1 - above / AUTOSCROLL_ZONE_PX)
    else if (below < AUTOSCROLL_ZONE_PX) step = AUTOSCROLL_MAX_PX * (1 - below / AUTOSCROLL_ZONE_PX)

    drag.current.step = step

    if (step === 0) {
      stopAutoscroll()
      return
    }
    if (frame.current) return

    const tick = () => {
      const before = scroller.scrollTop
      scroller.scrollTop += drag.current?.step ?? 0
      // The rows were measured in viewport coordinates, so scrolling moves them
      // out from under the pointer. Folding the scroll back into the offset
      // keeps the dragged row where the finger left it.
      if (drag.current) drag.current.scrolled += scroller.scrollTop - before
      const moved = scroller.scrollTop !== before
      frame.current = moved ? requestAnimationFrame(tick) : null
      if (moved && drag.current) {
        const offset = drag.current.offset + drag.current.scrolled
        setState({ ...drag.current, offset, to: targetFor(drag.current, offset) })
      }
    }

    frame.current = requestAnimationFrame(tick)
  }

  const onPointerMove = (event) => {
    const current = drag.current
    if (!current) return

    const travelled = event.clientY - current.startY

    if (!current.active) {
      if (Math.abs(travelled) < current.threshold) return
      current.active = true
      current.tops = itemRefs.current.slice(0, keys.length).map((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      })
    }

    current.offset = travelled
    const offset = travelled + current.scrolled
    setState({ ...current, offset, to: targetFor(current, offset) })
    autoscroll(event.clientY)
  }

  const finish = (event) => {
    const current = drag.current
    drag.current = null
    stopAutoscroll()

    if (!current?.active) {
      setState(null)
      return
    }

    justDragged.current = true

    const to =
      event?.type === 'pointerup'
        ? targetFor(current, current.offset + current.scrolled)
        : current.from

    if (to === current.from) {
      setState(null)
      return
    }

    // Held at the landing position rather than cleared. The reorder is a round
    // trip through the query cache, and letting go must not undo the drag for
    // the frame or two that takes.
    settledAt.current = order
    setState({ ...current, to, offset: landingOffset({ ...current, to }), settled: true })
    onReorder(current.from, to)
  }

  const onPointerDown = (index, event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Cleared here rather than on a timer: a gesture that produced no click
    // must not leave the guard armed for the next one.
    justDragged.current = false
    // Captured up front rather than at the threshold: a pointer that leaves the
    // element in the first few pixels would otherwise never report the move
    // that starts the drag.
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      from: index,
      to: index,
      startY: event.clientY,
      threshold: THRESHOLD_PX[event.pointerType] ?? THRESHOLD_PX.touch,
      offset: 0,
      scrolled: 0,
      step: 0,
      active: false,
      tops: null,
    }
  }

  // Dragging the row itself, which is the convention for a list of links and
  // needs no affordance to be found. Mouse only, and that is the whole reason
  // handleProps also exists: on touch the vertical axis is already the
  // scroller's, so taking it needs something explicit to grab.
  const dragProps = (index) =>
    disabled
      ? {}
      : {
          onPointerDown: (event) => {
            if (event.pointerType !== 'mouse') return
            onPointerDown(index, event)
          },
          onPointerMove,
          onPointerUp: finish,
          onPointerCancel: finish,
          onClickCapture: (event) => {
            if (!justDragged.current) return
            justDragged.current = false
            event.preventDefault()
            event.stopPropagation()
          },
        }

  // An explicit grab target, for pointers that cannot use the row body. Only
  // starts the gesture -- the move and release are tracked by dragProps on the
  // row, which the events bubble to.
  const handleProps = (index) =>
    disabled ? {} : { onPointerDown: (event) => onPointerDown(index, event) }

  // What each row is doing right now, as a transform the caller can apply. The
  // dragged row follows the pointer; every row between where it started and
  // where it would land slides into the slot the one next to it just left.
  const offsetFor = (index) => {
    if (!state) return 0
    const { from, to, offset, tops } = state
    if (index === from) return offset
    if (from < to && index > from && index <= to) return tops[index - 1].top - tops[index].top
    if (from > to && index >= to && index < from) return tops[index + 1].top - tops[index].top
    return 0
  }

  // No transform at rest. A translate3d of zero on every row would still hand
  // each one its own compositing layer for the whole life of the list.
  const itemProps = (index) => ({
    ref: setItemRef(index),
    style: state ? { transform: `translate3d(0, ${offsetFor(index)}px, 0)` } : undefined,
    'data-dragging': state && !state.settled && state.from === index ? 'true' : undefined,
    'data-settling': state && (state.settled || state.from !== index) ? 'true' : undefined,
  })

  return {
    scrollRef,
    itemProps,
    dragProps,
    handleProps,
    isDragging: state !== null && !state.settled,
    draggingIndex: state?.from ?? null,
  }
}
