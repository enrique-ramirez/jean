const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

// Native `behavior: 'smooth'` is not usable here: its duration is decided by the
// browser and grows with distance, so jumping across 30,000 rows would crawl for
// several seconds. This keeps the duration bounded no matter how far the jump is.
//
// `getTarget` is re-read on every frame rather than captured once, because rows
// measured during the flight shift where the destination actually sits -- most
// visibly in album mode, where group heights are measured rather than computed.
// A wheel event is not by itself a decision. Trackpad and mouse momentum keep
// emitting for a second or more after the fingers have left, so a jump asked
// for at the end of a flick was being cancelled by the tail of the gesture that
// came before it -- measured, a single delta of one pixel was enough to strand
// the scroll partway and leave the track off screen entirely. That is the whole
// of "jump to playing works sometimes": it depends on whether the list happened
// to still be coasting.
//
// Deliberate scrolling passes this in one or two events. A decaying tail does
// not, and the jump the user actually asked for gets to finish.
const CANCEL_DELTA_PX = 40

export function animateScrollTo(element, getTarget, { minMs = 240, maxMs = 700 } = {}) {
  const from = element.scrollTop
  const initialTarget = getTarget()
  if (initialTarget == null) return () => {}

  const duration = clamp(Math.abs(initialTarget - from) / 8, minMs, maxMs)
  const started = performance.now()

  let frame = 0
  let cancelled = false

  let wheeled = 0

  const onWheel = (event) => {
    wheeled += Math.abs(event.deltaY)
    if (wheeled >= CANCEL_DELTA_PX) cancel()
  }

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (frame) cancelAnimationFrame(frame)
    element.removeEventListener('wheel', onWheel)
    element.removeEventListener('touchstart', cancel)
  }

  const step = (now) => {
    if (cancelled) return
    const progress = clamp((now - started) / duration, 0, 1)
    const target = getTarget() ?? initialTarget

    element.scrollTop = from + (target - from) * easeInOutCubic(progress)

    if (progress < 1) frame = requestAnimationFrame(step)
    else cancel()
  }

  // Real input still wins -- an animation that fights the wheel feels broken --
  // but a touch is unambiguous where a wheel event is not, so only one of them
  // gets to stop this on its own.
  element.addEventListener('wheel', onWheel, { passive: true })
  element.addEventListener('touchstart', cancel, { passive: true })
  frame = requestAnimationFrame(step)

  return cancel
}
