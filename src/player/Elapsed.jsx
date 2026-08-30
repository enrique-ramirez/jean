import { useEffect, useState } from 'react'

import { formatTime, positionAt } from './position.js'

/**
 * Progress bar and elapsed time.
 *
 * This re-renders every animation frame, so it is deliberately a leaf holding
 * its own state. Do not lift `elapsed` into a shared store — once the track list
 * lands, that would repaint 30,000 virtualised rows sixty times a second.
 */
export function Elapsed({ snapshot }) {
  const [elapsed, setElapsed] = useState(() => positionAt(snapshot, performance.now()))

  useEffect(() => {
    let frame
    const tick = () => {
      setElapsed(positionAt(snapshot, performance.now()))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [snapshot])

  const duration = snapshot?.player?.activeItem?.duration ?? 0
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0

  return (
    <div className="elapsed">
      <div
        className="elapsed__track"
        role="progressbar"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={`${formatTime(elapsed)} of ${formatTime(duration)}`}
      >
        {/* scaleX rather than width: transforms skip layout entirely. */}
        <span className="elapsed__fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="elapsed__times">
        <span>{formatTime(elapsed)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}
