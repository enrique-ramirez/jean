import { Artwork } from '../ui/Artwork.jsx'
import { TrackRow } from './TrackRow.jsx'
import { FIELD, sameTagValue, value } from './fields.js'
import styles from './AlbumGroup.module.css'

// One fixed cover size per breakpoint. Scaling it to the run length made the
// column jitter between groups, which reads worse than the empty space beside a
// short run does.
export const ALBUM_COVER = 160
export const ALBUM_COVER_COMPACT = 72

// One contiguous album run. Beside the cover on desktop; beneath a compact
// header on a phone, where a side-by-side layout costs too much width.
export function AlbumGroup({
  group,
  rows,
  playlistId,
  columns,
  template,
  heat,
  patina,
  activeIndex,
  isPlaying,
  cursor,
  selection,
  matches,
  onSelect,
  onPlay,
  isCompactViewport,
}) {
  const indices = Array.from({ length: group.count }, (_, offset) => group.start + offset)
  const coverSize = isCompactViewport ? ALBUM_COVER_COMPACT : ALBUM_COVER

  return (
    <section className={styles.group} data-compact={isCompactViewport}>
      <div className={styles.aside}>
        <Artwork
          playlistId={playlistId}
          index={group.start}
          size={coverSize}
          className={styles.art}
          alt={`${group.album} cover`}
        />
        <div className={styles.caption}>
          <div className={styles.title}>{group.album}</div>
          <div className={styles.meta}>
            {group.albumArtist}
            {group.year ? ` · ${group.year}` : ''}
          </div>
        </div>
      </div>

      <div className={styles.tracks}>
        {indices.map((index) => (
          <TrackRow
            key={index}
            row={rows[index]}
            index={index}
            playlistId={playlistId}
            columns={columns}
            template={template}
            showArtwork={false}
            heat={heat[index]}
            patina={patina[index]}
            isActive={index === activeIndex}
            isPlaying={isPlaying}
            isSelected={selection.has(index)}
            isCursor={index === cursor}
            isMatch={matches?.has(index) ?? false}
            showArtist={!sameTagValue(value(rows[index], FIELD.artist), group.albumArtist)}
            onSelect={onSelect}
            onPlay={onPlay}
          />
        ))}
      </div>
    </section>
  )
}
