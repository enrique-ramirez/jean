import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ALBUM_COVER, ALBUM_COVER_COMPACT, AlbumGroup } from './AlbumGroup.jsx'
import { animateScrollTo } from '../ui/animateScroll.js'
import { TrackRow } from './TrackRow.jsx'
import { groupByAlbum } from './grouping.js'
import styles from './TrackList.module.css'

const ROW_HEIGHT = 46
const COMPACT_ROW_HEIGHT = 34
const GROUP_PADDING = 28
const GROUP_CAPTION = 56
const COMPACT_HEADER = ALBUM_COVER_COMPACT + 34

// Album groups are measured, not computed. Their height depends on how the
// caption wraps and which breakpoint is active, and getting that arithmetic
// wrong leaves visible gaps between groups -- so this is only the first guess
// the virtualiser uses before it measures the real thing.
const estimateGroupHeight = (group, isCompactViewport) => {
  const tracks = group.count * COMPACT_ROW_HEIGHT
  if (isCompactViewport) return COMPACT_HEADER + tracks + GROUP_PADDING
  return Math.max(ALBUM_COVER + GROUP_CAPTION + GROUP_PADDING, tracks + GROUP_PADDING)
}

export const TrackList = forwardRef(function TrackList(
  {
    rows,
    indices,
    viewKey,
    playlistId,
    scrollRef,
    layout,
    columns,
    template,
    albumTemplate,
    showArtwork,
    heat,
    patina,
    showHeat,
    activeIndex,
    isPlaying,
    cursor,
    selection,
    matches,
    onSelect,
    onPlay,
    onActiveDirectionChange,
    isCompactViewport,
  },
  ref,
) {
  const isAlbumLayout = layout === 'album'

  const groups = useMemo(() => (isAlbumLayout ? groupByAlbum(rows) : []), [isAlbumLayout, rows])

  const virtualizer = useVirtualizer({
    count: isAlbumLayout ? groups.length : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      isAlbumLayout ? estimateGroupHeight(groups[index], isCompactViewport) : ROW_HEIGHT,
    overscan: isAlbumLayout ? 3 : 12,
    // Compact rows are genuinely a fixed height, so they skip measurement
    // entirely and cost nothing per row.
    measureElement: isAlbumLayout ? (element) => element.getBoundingClientRect().height : undefined,
  })

  // The parent drives scrolling by track index; in album mode that has to be
  // translated into the group holding it.
  const cancelScroll = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTrack(index, { animate = false, align = 'center' } = {}) {
        cancelScroll.current?.()
        cancelScroll.current = null

        const target = isAlbumLayout
          ? groups.findIndex((entry) => index < entry.start + entry.count)
          : index
        if (target < 0) return

        if (!animate) {
          virtualizer.scrollToIndex(target, { align })
          return
        }

        const element = scrollRef.current
        if (!element) return

        cancelScroll.current = animateScrollTo(
          element,
          () => virtualizer.getOffsetForIndex(target, align)?.[0] ?? null,
        )
      },
    }),
    [isAlbumLayout, groups, virtualizer, scrollRef],
  )

  useEffect(() => () => cancelScroll.current?.(), [])

  // Measurements are cached by index, and an index means different things in
  // different layouts -- row 4 in list mode is not album 4. Without this reset,
  // switching layouts reuses the other one's heights. `viewKey` covers the same
  // trap from the other side: a new set of search results reuses the previous
  // set's indices for a completely different set of rows. Chunks arriving do
  // not change the key, so a load in progress is left alone.
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  useEffect(() => {
    virtualizerRef.current.measure()
  }, [isAlbumLayout, isCompactViewport, viewKey])

  const virtualItems = virtualizer.getVirtualItems()

  // Where the playing track sits relative to the viewport.
  //
  // Rendered is not the same as visible: overscan mounts rows beyond the fold,
  // and an album group is tall enough that its rows can be mounted while
  // sitting well below the screen. So when the row exists it is measured
  // against the scroll container, and only when it is absent entirely does the
  // index range decide the direction.
  const reported = useRef(undefined)

  useEffect(() => {
    const next = (() => {
      if (activeIndex < 0) return null

      const scroller = scrollRef.current
      if (!scroller) return null

      const row = scroller.querySelector('[data-active="true"]')
      if (row) {
        const rowRect = row.getBoundingClientRect()
        const viewRect = scroller.getBoundingClientRect()
        if (rowRect.bottom <= viewRect.top) return 'up'
        if (rowRect.top >= viewRect.bottom) return 'down'
        return null
      }

      if (virtualItems.length === 0) return null
      const first = virtualItems[0].index
      const last = virtualItems[virtualItems.length - 1].index
      const start = isAlbumLayout ? groups[first].start : first
      const end = isAlbumLayout ? groups[last].start + groups[last].count - 1 : last
      return activeIndex < start ? 'up' : activeIndex > end ? 'down' : null
    })()

    if (reported.current === next) return
    reported.current = next
    onActiveDirectionChange?.(next)
  })

  return (
    <div
      className={showHeat ? styles.list : `${styles.list} heat-off`}
      style={{ height: virtualizer.getTotalSize() }}
      role="grid"
      aria-rowcount={rows.length}
    >
      {virtualItems.map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={isAlbumLayout ? virtualizer.measureElement : undefined}
          className={styles.row}
          style={{
            transform: `translateY(${virtualRow.start}px)`,
            ...(isAlbumLayout ? null : { height: virtualRow.size }),
          }}
        >
          {isAlbumLayout ? (
            <AlbumGroup
              group={groups[virtualRow.index]}
              rows={rows}
              indices={indices}
              playlistId={playlistId}
              columns={columns}
              template={albumTemplate}
              heat={heat}
              patina={patina}
              activeIndex={activeIndex}
              isPlaying={isPlaying}
              cursor={cursor}
              selection={selection}
              matches={matches}
              onSelect={onSelect}
              onPlay={onPlay}
              isCompactViewport={isCompactViewport}
            />
          ) : (
            <TrackRow
              row={rows[virtualRow.index]}
              index={virtualRow.index}
              itemIndex={indices ? indices[virtualRow.index] : virtualRow.index}
              playlistId={playlistId}
              columns={columns}
              template={template}
              showArtwork={showArtwork}
              heat={heat[virtualRow.index]}
              patina={patina[virtualRow.index]}
              isActive={virtualRow.index === activeIndex}
              isPlaying={isPlaying}
              isSelected={selection.has(virtualRow.index)}
              isCursor={virtualRow.index === cursor}
              isMatch={matches?.has(virtualRow.index) ?? false}
              onSelect={onSelect}
              onPlay={onPlay}
            />
          )}
        </div>
      ))}
    </div>
  )
})
