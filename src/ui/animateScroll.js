const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

// Native `behavior: 'smooth'` is not usable here: its duration is decided by the
// browser and grows with distance, so jumping across 30,000 rows would crawl for
// several seconds. This keeps the duration bounded no matter how far the jump is.
//
// `getTarget` is re-read on every frame rather than captured once, because rows
// measured during the flight shift where the destination actually sits -- most
// visibly in album mode, where group heights are measured rather than computed.
export function animateScrollTo(element, getTarget, { minMs = 240, maxMs = 700 } = {}) {
  const from = element.scrollTop
  const initialTarget = getTarget()
  if (initialTarget == null) return () => {}

  const duration = clamp(Math.abs(initialTarget - from) / 8, minMs, maxMs)
  const started = performance.now()

  let frame = 0
  let cancelled = false

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (frame) cancelAnimationFrame(frame)
    element.removeEventListener('wheel', cancel)
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

  // Any real input wins immediately -- an animation that fights the wheel feels
  // broken.
  element.addEventListener('wheel', cancel, { passive: true })
  element.addEventListener('touchstart', cancel, { passive: true })
  frame = requestAnimationFrame(step)

  return cancel
}
