import { memo } from 'react'

import { Artwork } from '../ui/Artwork.jsx'
import { Stars } from '../ui/Stars.jsx'
import { formatTime } from '../player/position.js'
import { FIELD, number, timestamp, value } from './fields.js'
import { discNumber } from './grouping.js'
import { MAX_STARS, ratingOf, toStars } from './rating.js'
import styles from './TrackRow.module.css'

// An unreadable rating is drawn as unrated rather than as '--'. The column is
// already hidden wholesale when the player cannot resolve the field at all, so
// inside a library that has ratings the only thing an empty tag can mean is
// that this track has none.
function Rating({ row }) {
  const rating = ratingOf(row)
  const stars = rating === null ? 0 : toStars(rating)
  return <Stars value={stars} label={rating === null ? 'Unrated' : `${stars} of ${MAX_STARS} stars`} />
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
  // The ref whose cover this row draws -- its album's first row, so a record's
  // worth of rows share one URL and therefore one request. Its own, when the
  // caller has no grouping to hand.
  coverIndex = itemIndex,
  source,
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
  note = null,
  showDisc = false,
  onSelect,
}) {
  const title = value(row, FIELD.title) ?? 'Unknown title'
  const artist = value(row, FIELD.artist) ?? 'Unknown artist'
  const trackNumber = value(row, FIELD.trackNumber)

  // '1.01', the way a booklet writes it. Only where a heading cannot say it
  // instead -- the album layout groups the discs and labels them, so repeating
  // the disc on every row under its own heading would be saying it twice. The
  // fallback for an untagged track is its position in the view, which belongs
  // to no disc, so it never takes the prefix.
  const disc = showDisc && trackNumber !== null ? discNumber(row) : null

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
        {isActive && isPlaying ? (
          <NowPlayingBars />
        ) : disc !== null ? (
          `${disc}.${trackNumber}`
        ) : (
          (trackNumber ?? index + 1)
        )}
      </span>

      {/* index is the row's place in the view; itemIndex is the ref the source
          addresses it by. They differ in a filtered view. */}
      {showArtwork ? <Artwork src={source.artworkUrl(coverIndex)} size={34} /> : null}

      <span className={styles.names} data-inline={note !== null}>
        <span className={styles.title}>{title}</span>
        {/* No separator between the two. The note starts with the word the tag
            used -- 'feat.', 'w.' -- which is already a join, and a middot on
            every second row is the clutter this is removing. */}
        {note === null ? null : <span className={styles.note}>{note}</span>}
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
