import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ALBUM_COVER, ALBUM_COVER_COMPACT, AlbumGroup } from './AlbumGroup.jsx'
import { animateScrollTo } from '../ui/animateScroll.js'
import { TrackRow } from './TrackRow.jsx'
import { albumCoverRows, multiDiscRows } from './grouping.js'
import styles from './TrackList.module.css'

const ROW_HEIGHT = 46
const COMPACT_ROW_HEIGHT = 34
const GROUP_PADDING = 28
const GROUP_CAPTION = 56
const DISC_HEADING = 40
const COMPACT_HEADER = ALBUM_COVER_COMPACT + 34

// Album groups are measured, not computed. Their height depends on how the
// caption wraps and which breakpoint is active, and getting that arithmetic
// wrong leaves visible gaps between groups -- so this is only the first guess
// the virtualiser uses before it measures the real thing.
const estimateGroupHeight = (group, isCompactViewport) => {
  const tracks = group.count * COMPACT_ROW_HEIGHT + (group.discs?.length ?? 0) * DISC_HEADING
  if (isCompactViewport) return COMPACT_HEADER + tracks + GROUP_PADDING
  return Math.max(ALBUM_COVER + GROUP_CAPTION + GROUP_PADDING, tracks + GROUP_PADDING)
}

export const TrackList = forwardRef(function TrackList(
  {
    rows,
    groups,
    indices,
    source,
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
    onActiveDirectionChange,
    isCompactViewport,
  },
  ref,
) {
  const isAlbumLayout = layout === 'album'

  // The list draws no group headings, so a multi-disc album has to say so in
  // the track numbers instead -- one byte per row, filled from the same runs
  // the album layout draws.
  const discPrefixed = useMemo(
    () => (isAlbumLayout ? null : multiDiscRows(groups, rows.length)),
    [isAlbumLayout, groups, rows.length],
  )

  // Off the same runs, and only where rows draw their own covers. The album
  // layout asks `AlbumGroup` for one cover per group and never gets here.
  const coverRows = useMemo(
    () => (isAlbumLayout || !showArtwork ? null : albumCoverRows(groups, rows.length)),
    [isAlbumLayout, showArtwork, groups, rows.length],
  )

  // A row position becomes the ref the source addresses that cover by: first to
  // the album run's opening row, then through `indices`, because a filtered view
  // renumbers everything. Doing it in the other order would look up a playlist
  // index in a table of row positions.
  const coverIndexOf = (position) => {
    const row = coverRows ? coverRows[position] : position
    return indices ? indices[row] : row
  }

  // How far down the scroll container the list actually begins. The view header
  // and the toolbar sit above it, so row 0 is not at scroll offset 0 -- and
  // without telling the virtualiser that, every scrollToIndex lands short by
  // exactly this much. Rendering still looked right, because the rows are
  // positioned inside a list that is itself in normal flow; only the scroll
  // arithmetic was wrong, which is why it read as "jump to playing is a bit
  // off" rather than as anything obviously broken. On a short viewport that
  // same error is the whole distance, so the track never came into view at all.
  const listElement = useRef(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const list = listElement.current
    const scroller = scrollRef.current
    if (!list || !scroller) return undefined

    const measure = () => {
      // Rounded so that `start - scrollMargin` stays the whole number it was
      // before this existed. A fractional margin would otherwise leak into
      // every row's transform, and sub-pixel churn would re-render the list
      // for nothing.
      const next = Math.round(
        list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      )
      setScrollMargin((current) => (current === next ? current : next))
    }

    measure()

    // The header is what moves the list, and the only boxes that grow when it
    // does are the list's own ancestors -- so observing the chain up to the
    // scroller catches a wrapping title, the stats appearing once rows load,
    // the finder opening, and the loading bar, without knowing about any of
    // them. `.rows` is display:contents and generates no box, so observing it
    // costs nothing and reports nothing.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    for (let node = list.parentElement; node && node !== scroller; node = node.parentElement) {
      observer.observe(node)
    }
    return () => observer.disconnect()
  }, [scrollRef])

  const virtualizer = useVirtualizer({
    scrollMargin,
    count: isAlbumLayout ? groups.length : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      isAlbumLayout ? estimateGroupHeight(groups[index], isCompactViewport) : ROW_HEIGHT,
    overscan: isAlbumLayout ? 3 : 12,
    // Measurements are cached by *item key*, and the default key is the index --
    // so group 0 of one search inherits the measured height of group 0 of the
    // last one. Two albums of the same length measure the same and nothing is
    // wrong; an album of nineteen two-line rows landing where a shorter one was
    // is 133px taller than the virtualiser thinks, and it lays the next group
    // over the end of it. It stayed wrong, too: measureElement reports on mount
    // and on resize, and a group that was already there did neither.
    //
    // Keying by the album gives a new result set new items, which are measured
    // when they mount like any other. `measure()` below still covers the case
    // this cannot: switching layout, where the same key means a different shape.
    getItemKey: isAlbumLayout ? (index) => groups[index]?.key ?? index : undefined,
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

        const element = scrollRef.current
        if (!element) return

        // Centring is measured off the row, not computed from the index.
        //
        // In album mode the virtualiser's items are groups, so asking it to
        // centre gets the *album* centred and the track left wherever it falls
        // inside it -- measured at up to 271px out on a 735px viewport, and off
        // screen entirely once an album is longer than the window. In list mode
        // a row and its index are the same thing, so the two agree and this is
        // one path for both rather than a special case for one.
        //
        // Returns null until the row is mounted, which is what the fallback is
        // for: the first frames aim at the group, that brings the row into
        // existence, and the target refines to the track itself. It converges
        // rather than oscillating -- the offset is absolute, so once the row is
        // measurable every frame computes the same answer.
        const centreOnRow = () => {
          const row = element.querySelector(`[data-row="${index}"]`)
          if (!row) return null
          const seen = row.getBoundingClientRect()
          const view = element.getBoundingClientRect()
          return element.scrollTop + (seen.top + seen.bottom) / 2 - (view.top + view.bottom) / 2
        }

        const offsetFor = () =>
          (align === 'center' ? centreOnRow() : null) ??
          virtualizer.getOffsetForIndex(target, align)?.[0] ??
          null

        if (!animate) {
          virtualizer.scrollToIndex(target, { align })
          // The row exists now even if it did not a moment ago, so a second
          // pass puts the track where the group just went.
          if (align === 'center') {
            requestAnimationFrame(() => {
              const refined = centreOnRow()
              if (refined != null) element.scrollTop = refined
            })
          }
          return
        }

        cancelScroll.current = animateScrollTo(element, offsetFor)
      },
    }),
    [isAlbumLayout, groups, virtualizer, scrollRef],
  )

  useEffect(() => () => cancelScroll.current?.(), [])

  // Two different traps, and only one of them is this reset's.
  //
  // Keys handle *different data at the same index* -- a new set of search
  // results, where group 0 is a different album. getItemKey above does that,
  // and it has to, because measure() cannot: it runs after the refs have
  // already measured the new elements, and it throws those measurements away.
  // Nothing re-measures afterwards, since measureElement reports on mount and
  // on resize and a mounted group does neither. That is what left the first
  // album of a search lying 133px under the second.
  //
  // This reset handles the other one: *the same data in a different shape*.
  // Row 4 in list mode is not album 4, and a compact album group is not a wide
  // one, so the cached heights are meaningless across either switch.
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  useEffect(() => {
    virtualizerRef.current.measure()
  }, [isAlbumLayout, isCompactViewport])

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
      ref={listElement}
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
            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            ...(isAlbumLayout ? null : { height: virtualRow.size }),
          }}
        >
          {isAlbumLayout ? (
            <AlbumGroup
              group={groups[virtualRow.index]}
              rows={rows}
              indices={indices}
              source={source}
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
              isCompactViewport={isCompactViewport}
            />
          ) : (
            <TrackRow
              row={rows[virtualRow.index]}
              index={virtualRow.index}
              itemIndex={indices ? indices[virtualRow.index] : virtualRow.index}
              coverIndex={coverIndexOf(virtualRow.index)}
              source={source}
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
              showDisc={discPrefixed[virtualRow.index] === 1}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </div>
  )
})
