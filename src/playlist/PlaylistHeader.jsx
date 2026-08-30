import { Shuffle } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import { Chip } from '../ui/Chip.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import { Mosaic } from './Mosaic.jsx'
import { formatDuration } from './stats.js'
import styles from './PlaylistHeader.module.css'

function PlayedMeter({ share }) {
  return (
    <div className={styles.meter}>
      <div className={styles.meterTrack}>
        <div className={styles.meterFill} style={{ transform: `scaleX(${share})` }} />
      </div>
      <span>{Math.round(share * 100)}% played</span>
    </div>
  )
}

export function PlaylistHeader({ playlist, stats, hasPlayCounts, onPlay, shuffle, canPlay }) {
  const duration = formatDuration(stats.seconds)
  const span =
    stats.earliest && stats.latest
      ? stats.earliest === stats.latest
        ? `${stats.earliest}`
        : `${stats.earliest}-${stats.latest}`
      : null

  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <p className={styles.eyebrow}>{playlist.isCurrent ? 'Playing from' : 'Playlist'}</p>
        <h1 className={styles.title}>{playlist.title}</h1>

        <div className={styles.stats}>
          <span>
            <b>{stats.trackCount.toLocaleString()}</b> tracks
          </span>
          {duration ? (
            <>
              <span className={styles.separator}>·</span>
              <span>{duration}</span>
            </>
          ) : null}
          {span ? (
            <>
              <span className={styles.separator}>·</span>
              <span>{span}</span>
            </>
          ) : null}
          {hasPlayCounts ? <PlayedMeter share={stats.playedShare} /> : null}
        </div>

        {stats.topGenres.length > 0 ? (
          <div className={styles.chips}>
            {stats.topGenres.map((genre) => (
              <Chip key={genre.name} label={genre.name} value={`${genre.share}%`} />
            ))}
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button variant="primary" icon={PlayIcon} onClick={onPlay} disabled={!canPlay}>
            Play
          </Button>
          <Button
            icon={Shuffle}
            onClick={shuffle.toggleShuffle}
            disabled={!shuffle.canShuffle}
            aria-pressed={shuffle.isShuffle}
            title={shuffle.orderName ? `Playback order: ${shuffle.orderName}` : 'Shuffle'}
          >
            Shuffle
          </Button>
        </div>
      </div>

      <Mosaic playlistId={playlist.id} trackCount={stats.trackCount} />
    </header>
  )
}
