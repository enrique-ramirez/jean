import { useEffect, useState } from 'react'

import { Shuffle } from 'lucide-react'

import { readTrack } from '../api/beefweb.js'
import { useIsCompactViewport } from '../hooks/useMediaQuery.js'
import { Artwork } from '../ui/Artwork.jsx'
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from '../ui/icons.jsx'
import { SeekBar, useElapsedLabel } from './SeekBar.jsx'
import { formatTime } from './position.js'
import { Volume, VolumePopover } from './Volume.jsx'
import {
  usePlaybackOrder,
  usePlayPause,
  usePlayer,
  useSeek,
  useTransport,
  useVolume,
} from './usePlayer.js'
import styles from './StatusBar.module.css'

// Times are their own leaf so the animation frame loop repaints two spans
// rather than the whole bar.
function Times({ snapshot }) {
  const elapsed = useElapsedLabel(snapshot)
  const duration = snapshot?.player?.activeItem?.duration ?? 0

  return (
    <div className={styles.times}>
      <span className="tabular">{formatTime(elapsed)}</span>
      <span className={styles.separator}>/</span>
      <span className="tabular">{formatTime(duration)}</span>
    </div>
  )
}

// One component, two shapes: full transport on desktop, compact on mobile. The
// seek bar spans the whole width above both.
// The playing state alternates between two motions rather than settling on one,
// so neither has time to become wallpaper.
const MOTIONS = ['equalizer', 'fluid']
const MOTION_CYCLE_MS = 8000

export function StatusBar() {
  const { data: snapshot, isPending, isError, error } = usePlayer()
  const [motion, setMotion] = useState(MOTIONS[0])
  const isCompactViewport = useIsCompactViewport()
  const { volume, setValue, setMuted } = useVolume()

  const playing = snapshot?.player?.playbackState === 'playing'

  useEffect(() => {
    if (!playing) {
      setMotion(MOTIONS[0])
      return undefined
    }

    const timer = setInterval(
      () => setMotion((current) => MOTIONS[(MOTIONS.indexOf(current) + 1) % MOTIONS.length]),
      MOTION_CYCLE_MS,
    )
    return () => clearInterval(timer)
  }, [playing])

  const playPause = usePlayPause()
  const seek = useSeek()
  const transport = useTransport()
  const order = usePlaybackOrder()

  if (isPending || isError) {
    return (
      <footer className={styles.statusbar}>
        <p className={styles.notice}>
          {isPending ? 'Connecting to the player…' : `Can’t reach the player — ${error.message}`}
        </p>
      </footer>
    )
  }

  const { player } = snapshot
  const track = readTrack(player)
  const item = player.activeItem
  const isPlaying = player.playbackState === 'playing'
  const hasTrack = Boolean(item && item.index >= 0)

  return (
    <footer className={styles.statusbar}>
      <SeekBar snapshot={snapshot} onSeek={(position) => seek.mutate(position)} />

      <div className={styles.row}>
        <div className={styles.now}>
          <Artwork
            key={hasTrack ? `${item.playlistId}:${item.index}` : 'idle'}
            playlistId={hasTrack ? item.playlistId : null}
            index={hasTrack ? item.index : null}
            size={44}
            className={styles.art}
          />

          <div className={styles.names}>
            <span className={styles.title}>{track?.title ?? 'Nothing playing'}</span>
            <span className={styles.artist}>{track?.artist ?? '—'}</span>
          </div>
        </div>

        <div className={styles.transport}>
          {/* Playback order is global player state, so it belongs with the
              other global controls rather than in a view header, where sitting
              next to Play made it read as "shuffle these tracks" -- which is
              not what it does. Left of the transport, not among it: this is the
              mode the buttons to its right operate in, not a fourth button. */}
          <button
            type="button"
            className={styles.order}
            aria-label="Shuffle"
            aria-pressed={order.isShuffle}
            disabled={!order.canShuffle}
            title={order.orderName ? `Playback order: ${order.orderName}` : 'Shuffle'}
            onClick={order.toggleShuffle}
          >
            <Shuffle size={16} strokeWidth={2} />
          </button>

          <button
            type="button"
            className={styles.skip}
            aria-label="Previous track"
            onClick={() => transport.previous.mutate()}
          >
            <SkipBackIcon size={18} />
          </button>

          <button
            type="button"
            className={styles.toggle}
            data-playing={isPlaying}
            data-motion={motion}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => playPause.mutate()}
          >
            {isPlaying ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
          </button>

          <button
            type="button"
            className={styles.skip}
            aria-label="Next track"
            onClick={() => transport.next.mutate()}
          >
            <SkipForwardIcon size={18} />
          </button>
        </div>

        {isCompactViewport ? (
          <VolumePopover volume={volume} onChange={setValue} />
        ) : (
          <div className={styles.trailing}>
            <Times snapshot={snapshot} />
            <Volume
              volume={volume}
              onChange={setValue}
              onToggleMute={() => setMuted(!volume?.isMuted)}
            />
          </div>
        )}
      </div>
    </footer>
  )
}
