import { useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'

import { useDismissable } from '../hooks/useDismissable.js'
import { useDragFraction } from '../ui/useDragFraction.js'
import { fractionToVolume, volumePercent, volumeToFraction } from './volume.js'
import styles from './Volume.module.css'

const iconFor = (percent, isMuted) => {
  if (isMuted || percent === 0) return VolumeX
  return percent < 50 ? Volume1 : Volume2
}

export function VolumeButton({ volume, onToggleMute, ...props }) {
  const percent = volumePercent(volume)
  const Icon = iconFor(percent, volume?.isMuted)

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onToggleMute}
      aria-pressed={Boolean(volume?.isMuted)}
      aria-label={volume?.isMuted ? 'Unmute' : 'Mute'}
      title={volume?.isMuted ? 'Muted' : `Volume ${percent}%`}
      {...props}
    >
      <Icon size={17} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

export function VolumeSlider({ volume, onChange, orientation = 'horizontal', className }) {
  const { ref, fraction, isDragging, handlers } = useDragFraction({
    onDrag: (next) => onChange(fractionToVolume(volume, next)),
    onCommit: (next) => onChange(fractionToVolume(volume, next)),
    disabled: !volume,
    orientation,
  })

  const shown = fraction ?? volumeToFraction(volume)
  const percent = Math.round(shown * 100)

  return (
    <div
      ref={ref}
      className={[styles.slider, className].filter(Boolean).join(' ')}
      data-orientation={orientation}
      data-dragging={isDragging}
      data-muted={Boolean(volume?.isMuted)}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={volume?.isMuted ? 'Muted' : `${percent}%`}
      {...handlers}
    >
      <span className={styles.rail} />
      <span
        className={styles.fill}
        style={{ transform: orientation === 'vertical' ? `scaleY(${shown})` : `scaleX(${shown})` }}
      />
      <span
        className={styles.thumb}
        style={orientation === 'vertical' ? { bottom: `${shown * 100}%` } : { left: `${shown * 100}%` }}
      />
    </div>
  )
}

// Mobile. A column above the button rather than taking over the row: the track
// name stays readable, and dragging to the bottom is the mute gesture -- which
// is why the button here only opens and closes.
export function VolumePopover({ volume, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useDismissable(isOpen, () => setIsOpen(false))

  return (
    <div className={styles.popoverAnchor} ref={ref}>
      {isOpen ? (
        <div className={styles.popover}>
          <VolumeSlider volume={volume} onChange={onChange} orientation="vertical" />
          <span className={styles.readout}>{volumePercent(volume)}</span>
        </div>
      ) : null}

      <VolumeButton
        volume={volume}
        onToggleMute={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? 'Hide volume' : 'Show volume'}
        aria-expanded={isOpen}
      />
    </div>
  )
}

export function Volume({ volume, onChange, onToggleMute }) {
  return (
    <div className={styles.volume}>
      <VolumeButton volume={volume} onToggleMute={onToggleMute} />
      <VolumeSlider volume={volume} onChange={onChange} />
    </div>
  )
}
