import { useEffect, useState } from 'react'

import { useDragFraction } from '../ui/useDragFraction.js'
import { positionAt } from './position.js'
import styles from './SeekBar.module.css'

// Re-renders every animation frame, so it is deliberately a leaf holding its own
// state. Do not lift `elapsed` into a shared store -- that would repaint the
// virtualised track list sixty times a second.
export function SeekBar({ snapshot, onSeek }) {
  const [elapsed, setElapsed] = useState(() => positionAt(snapshot, performance.now()))

  const duration = snapshot?.player?.activeItem?.duration ?? 0
  const canSeek = duration > 0

  useEffect(() => {
    let frame
    const tick = () => {
      setElapsed(positionAt(snapshot, performance.now()))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [snapshot])

  // Seeking commits on release rather than on drag: scrubbing would otherwise
  // fire a request per pointer move and the player would stutter chasing them.
  const { ref, fraction, isDragging, handlers } = useDragFraction({
    onCommit: (next) => onSeek(next * duration),
    disabled: !canSeek,
  })

  const progress = fraction ?? (duration > 0 ? Math.min(elapsed / duration, 1) : 0)

  return (
    <div
      ref={ref}
      className={styles.bar}
      data-scrubbing={isDragging}
      data-seekable={canSeek}
      role="slider"
      tabIndex={canSeek ? 0 : -1}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(progress * duration)}
      {...handlers}
    >
      <span className={styles.rail} />
      {/* scaleX rather than width: transforms skip layout entirely. */}
      <span className={styles.fill} style={{ transform: `scaleX(${progress})` }} />
      <span className={styles.thumb} style={{ left: `${progress * 100}%` }} />
    </div>
  )
}

export function useElapsedLabel(snapshot) {
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

  return elapsed
}
