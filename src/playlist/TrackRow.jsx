import { memo } from 'react'

import { Artwork } from '../ui/Artwork.jsx'
import { formatTime } from '../player/position.js'
import { FIELD, number, timestamp, value } from './fields.js'
import styles from './TrackRow.module.css'

const MAX_STARS = 5

function Rating({ row }) {
  const rating = number(row, FIELD.rating)
  if (rating === null || rating < 0 || rating > MAX_STARS) return <span className={styles.absent}>--</span>

  const filled = Math.round(rating)
  return (
    <span className={styles.rating} aria-label={`${filled} of ${MAX_STARS} stars`}>
      {Array.from({ length: MAX_STARS }, (_, star) => (
        <span key={star} data-off={star >= filled} aria-hidden="true">
          *
        </span>
      ))}
    </span>
  )
}

function shortDate(row) {
  const played = timestamp(row, FIELD.lastPlayed)
  if (played === null) return null
  return new Date(played).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

function Cell({ column, row }) {
  const className = [styles.cell, column.align === 'right' ? styles.numeric : null]
    .filter(Boolean)
    .join(' ')

  if (column.kind === 'rating') {
    return (
      <span className={className}>
        <Rating row={row} />
      </span>
    )
  }

  if (column.kind === 'duration') {
    const seconds = number(row, FIELD.duration)
    return <span className={`${className} tabular`}>{seconds === null ? '--' : formatTime(seconds)}</span>
  }

  if (column.kind === 'playCount') {
    const plays = number(row, FIELD.playCount) ?? 0
    return (
      <span className={`${className} tabular`} data-zero={plays === 0}>
        {plays === 0 ? '--' : plays}
      </span>
    )
  }

  if (column.kind === 'date') {
    return <span className={`${className} tabular`}>{shortDate(row) ?? '--'}</span>
  }

  if (column.kind === 'bitrate') {
    const rate = number(row, FIELD.bitrate)
    return <span className={`${className} tabular`}>{rate === null ? '--' : rate}</span>
  }

  return <span className={className}>{value(row, column.field) ?? '--'}</span>
}

function NowPlayingBars() {
  return (
    <span className={styles.equalizer} aria-label="Now playing">
      <i />
      <i />
      <i />
    </span>
  )
}

function TrackRowComponent({
  row,
  index,
  itemIndex,
  playlistId,
  columns,
  template,
  showArtwork,
  heat,
  patina,
  isActive,
  isPlaying,
  isSelected,
  isCursor,
  isMatch,
  showArtist = true,
  onSelect,
}) {
  const title = value(row, FIELD.title) ?? 'Unknown title'
  const artist = value(row, FIELD.artist) ?? 'Unknown artist'
  const trackNumber = value(row, FIELD.trackNumber)

  return (
    <div
      className={styles.track}
      style={{ gridTemplateColumns: template, '--heat': heat, '--patina': patina }}
      data-row={index}
      data-active={isActive}
      data-selected={isSelected}
      data-cursor={isCursor}
      data-match={isMatch}
      role="row"
      aria-selected={isSelected}
      onPointerDown={(event) => {
        // Secondary click must leave the selection alone -- collapsing it here
        // would empty a multi-track selection before the context menu that is
        // about to act on it has even opened.
        if (event.button === 0) onSelect(index, event)
      }}
    >
      <span className={`${styles.index} tabular`}>
        {isActive && isPlaying ? <NowPlayingBars /> : (trackNumber ?? index + 1)}
      </span>

      {/* index is the row's place in the view; itemIndex is where the player
          keeps it. They differ in a filtered view, and artwork is addressed by
          the player's index. */}
      {showArtwork ? <Artwork playlistId={playlistId} index={itemIndex} size={34} /> : null}

      <span className={styles.names}>
        <span className={styles.title}>{title}</span>
        {showArtist ? <span className={styles.artist}>{artist}</span> : null}
      </span>

      {columns.map((column) => (
        <Cell key={column.id} column={column} row={row} />
      ))}
    </div>
  )
}

// Rows mount and unmount continuously while scrolling, so the cheap bail-out
// matters more here than anywhere else in the app.
export const TrackRow = memo(TrackRowComponent)
