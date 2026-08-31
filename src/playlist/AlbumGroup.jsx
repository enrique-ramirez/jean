import { Fragment } from 'react'

import { Artwork } from '../ui/Artwork.jsx'
import { TrackRow } from './TrackRow.jsx'
import { FIELD, featuring, sameTagValue, value } from './fields.js'
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
  indices,
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
  isCompactViewport,
}) {
  const coverSize = isCompactViewport ? ALBUM_COVER_COMPACT : ALBUM_COVER
  const itemIndexOf = (position) => (indices ? indices[position] : position)

  // A single-disc album is one unlabelled run, so the ordinary case renders
  // through the same loop rather than through a branch around it.
  const runs = group.discs ?? [{ number: null, start: group.start, count: group.count }]

  // Three states, and the caption to the left is why there are three. It
  // already names the album artist, so a row whose artist is that name plus a
  // guest only has to say the guest -- on the title's line, the way a sleeve
  // prints it and the way every distributor delivers it. A row whose artist is
  // someone else entirely is a compilation, where the artist is the fact about
  // the row rather than a footnote to it, and it keeps its own line.
  //
  // The second line was previously both cases at once, which is what looked
  // bad: 'Post Malone' repeated down the column under every other title, and a
  // rhythm that broke between one-line and two-line rows for a difference of a
  // few words.
  const track = (index) => {
    const artist = value(rows[index], FIELD.artist)
    const guest = featuring(artist, group.albumArtist)

    return (
      <TrackRow
        key={index}
        row={rows[index]}
        index={index}
        itemIndex={itemIndexOf(index)}
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
        showArtist={guest === null && !sameTagValue(artist, group.albumArtist)}
        note={guest}
        onSelect={onSelect}
      />
    )
  }

  return (
    <section className={styles.group} data-compact={isCompactViewport}>
      <div className={styles.aside}>
        <Artwork
          playlistId={playlistId}
          index={itemIndexOf(group.start)}
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
        {runs.map((run) => (
          <Fragment key={run.start}>
            {/* Above disc one as well as the rest. A label that only appears
                once you are already past the boundary tells you where you are
                too late to have used it, and the first run is the one that
                establishes what these headings mean. The rule is what makes it
                a break rather than a row: 'Disc 2' on its own line looks like a
                track called Disc 2. */}
            {run.number === null ? null : <h3 className={styles.disc}>Disc {run.number}</h3>}
            {Array.from({ length: run.count }, (_, offset) => track(run.start + offset))}
          </Fragment>
        ))}
      </div>
    </section>
  )
}
