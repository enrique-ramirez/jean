import { Chip } from '../ui/Chip.jsx'
import { formatDuration } from './stats.js'
import styles from './ViewHeader.module.css'

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

// One header for anything that is a list of tracks. A playlist and a set of
// search results differ in where they came from, not in what is worth saying
// about them -- how many tracks, how long, which years, what it is made of.
export function ViewHeader({ eyebrow, title, stats, hasPlayCounts, actions, aside }) {
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
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>

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

        <div className={styles.actions}>{actions}</div>
      </div>

      {aside}
    </header>
  )
}
