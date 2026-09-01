import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Flame, LayoutList, ListMusic } from 'lucide-react'

import { useStoredState } from '../hooks/useStoredState.js'
import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { Button } from '../ui/Button.jsx'
import { Menu } from '../ui/Menu.jsx'
import { mergeHandlers } from '../ui/mergeHandlers.js'
import { Segmented } from '../ui/Segmented.jsx'
import { ColumnsMenu } from './ColumnsMenu.jsx'
import { HeatLegend } from './HeatLegend.jsx'
import { TrackList } from './TrackList.jsx'
import { DEFAULT_COLUMN_IDS, resolveColumns } from './columns.js'
import { groupByAlbum } from './grouping.js'
import { targetsFrom } from './trackTargets.js'
import { useAvailableFields } from './useAvailableFields.js'
import { useTrackContextMenu } from './useTrackContextMenu.jsx'
import { useTrackDragSource } from './useTrackDragSource.js'
import { useTrackSelection } from './useTrackSelection.js'
import styles from './TrackBrowser.module.css'

const LAYOUTS = [
  { value: 'compact', label: 'List', icon: LayoutList },
  { value: 'album', label: 'Albums', icon: ListMusic },
]

const PAGE = 12

// Everything a list of tracks does regardless of where the tracks came from:
// layout, columns, heat, selection, keyboard navigation, scrolling to a track.
//
// `rows` is the view; `indices` maps a position in it back to the ref the
// source addresses, and is null when the two are the same thing. Selection, the
// cursor and heat are all in view space -- only artwork and playback cross back
// over.
export const TrackBrowser = forwardRef(function TrackBrowser(
  {
    rows,
    indices = null,
    source,
    viewKey,
    heat,
    patina,
    activeIndex = -1,
    isPlaying,
    matches = null,
    isLoading,
    loaded,
    total,
    scrollRef,
    isCompactViewport,
    header,
    toolbarLeading,
    emptyNotice,
    keysEnabled = true,
    // Off unless a view asks for it. A set of search results changes under every
    // keystroke, and jumping to the playing track the moment it appears among
    // them would take the view away from the matches just typed for.
    canFollowPlayback = false,
    onPlay,
    onOpenFinder,
  },
  ref,
) {
  const listRef = useRef(null)

  const [layout, setLayout] = useStoredState('jean.layout', 'compact')
  const [showHeat, setShowHeat] = useStoredState('jean.heat', true)
  const [showArtwork, setShowArtwork] = useStoredState('jean.artwork', true)
  const [enabledIds, setEnabledIds] = useStoredState('jean.columns', DEFAULT_COLUMN_IDS)
  const [followPlayback] = useStoredState('jean.followPlayback', true)
  const [isColumnsOpen, setIsColumnsOpen] = useState(false)
  const [isHeatInfoOpen, setIsHeatInfoOpen] = useState(false)
  const [heatIntroSeen, setHeatIntroSeen] = useStoredState('jean.heatIntroSeen', false)
  const [activeDirection, setActiveDirection] = useState(null)
  const lastDirection = useRef('down')

  const selection = useTrackSelection(rows.length, viewKey)
  const { isAvailable, hasPlayCounts } = useAvailableFields(rows)

  const dismissHeatInfo = useCallback(() => {
    setIsHeatInfoOpen(false)
    setHeatIntroSeen(true)
  }, [setHeatIntroSeen])

  // Explained once, the first time the shading is actually on screen -- which
  // is the only moment the question occurs to anyone. After that it lives in
  // the columns menu and this never fires again.
  useEffect(() => {
    if (heatIntroSeen || !hasPlayCounts || !showHeat) return
    setIsHeatInfoOpen(true)
  }, [heatIntroSeen, hasPlayCounts, showHeat])

  // Grouped here because both layouts want it and neither owns it. The album
  // layout draws the groups; the list layout draws none, but a multi-disc album
  // still grows a disc prefix on the track number, and the column has to be
  // wide enough for it before a single row is laid out.
  const groups = useMemo(() => groupByAlbum(rows), [rows])
  const hasDiscs = useMemo(() => groups.some((group) => group.discs), [groups])

  const { optional, template, albumTemplate } = useMemo(
    () => resolveColumns({ enabledIds, showArtwork, isCompactViewport, isAvailable, hasDiscs }),
    [enabledIds, showArtwork, isCompactViewport, isAvailable, hasDiscs],
  )

  const scrollToTrack = useCallback((position, options) => {
    listRef.current?.scrollToTrack(position, options)
  }, [])

  const { moveCursorTo, moveCursor } = selection

  const play = useCallback(
    (position) => {
      moveCursorTo(position)
      onPlay(position)
    },
    [moveCursorTo, onPlay],
  )

  const preview = useCallback(
    (position) => {
      moveCursorTo(position)
      scrollToTrack(position, { align: 'center' })
    },
    [moveCursorTo, scrollToTrack],
  )

  useImperativeHandle(ref, () => ({ play, preview, scrollToTrack }), [play, preview, scrollToTrack])

  const trackMenu = useTrackContextMenu({
    rows,
    indices,
    source,
    selection: selection.selection,
    onSelectOnly: moveCursorTo,
  })

  const trackDrag = useTrackDragSource({
    rows,
    indices,
    source,
    selection: selection.selection,
  })

  // Pressing inside a multi-track selection must not collapse it on the way
  // down: this could be the start of a drag of all of them, and every file
  // manager defers that decision to the release. Without it a multi-track drag
  // is impossible -- the selection is gone before the pointer has moved.
  const pendingCollapse = useRef(null)

  const selectFromPointer = useCallback(
    (index, event) => {
      const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey
      if (plain && selection.selection.has(index) && selection.selection.size > 1) {
        pendingCollapse.current = index
        return
      }
      selection.selectFromEvent(index, event)
    },
    [selection],
  )

  const resolveCollapse = useCallback(() => {
    const pending = pendingCollapse.current
    pendingCollapse.current = null
    // A drag used the selection, so it stands. A click did not, so it collapses.
    if (pending !== null && !trackDrag.didDrag()) moveCursorTo(pending)
  }, [moveCursorTo, trackDrag])

  // What plays a track depends on the device driving, not on the viewport --
  // the same rule useSortableList uses to decide that only a mouse drags a row.
  // Recorded on the way down rather than read off the click, because `click` is
  // a PointerEvent in Chromium and Safari but a plain MouseEvent in Firefox,
  // where pointerType is undefined and every desktop click would read as a tap.
  const pointerType = useRef('mouse')

  const playFromPointer = useCallback(
    (event) => {
      const aimed = targetsFrom(event, rows, selection.selection)
      if (aimed) play(aimed.index)
    },
    [rows, selection.selection, play],
  )

  // A tap plays; a click selects and a double-click plays. On a pointer a
  // selection is worth having -- the modifier keys exist to build one, and every
  // file manager separates choosing from opening. Touch has neither, and a tap
  // that only highlighted left the phone with no way to play an individual track
  // at all: the header Play button was the entire surface.
  //
  // `click` rather than `pointerup`, because the browser withholds it entirely
  // when the gesture turns out to be a scroll -- which is most of what a finger
  // does in a list -- and useLongPress already swallows the one after a hold.
  const onRowsClick = useCallback(
    (event) => {
      // detail counts clicks in a rapid sequence. A double-tap otherwise plays
      // twice, restarting the track under the finger that just started it.
      if (pointerType.current === 'mouse' || event.detail > 1) return
      playFromPointer(event)
    },
    [playFromPointer],
  )

  const onRowsDoubleClick = useCallback(
    (event) => {
      if (pointerType.current !== 'mouse') return
      playFromPointer(event)
    },
    [playFromPointer],
  )

  // Scrolling follows the cursor only when the keyboard moved it. Chunks
  // arriving can clamp the cursor too, and reacting to that would drag the view
  // back to the top every time a chunk lands mid-scroll.
  const pendingScroll = useRef(false)

  const keyMove = useCallback(
    (delta, options) => {
      pendingScroll.current = true
      moveCursor(delta, options)
    },
    [moveCursor],
  )

  const keyMoveTo = useCallback(
    (position) => {
      pendingScroll.current = true
      moveCursorTo(position)
    },
    [moveCursorTo],
  )

  useEffect(() => {
    if (!pendingScroll.current) return
    pendingScroll.current = false
    scrollToTrack(selection.cursor, { align: 'auto' })
  }, [selection.cursor, scrollToTrack])

  // Which index was last *followed*, rather than which one was last seen. That
  // is what keeps this from fighting the user: scrolling away does not change
  // `activeIndex`, so nothing re-fires and the view stays where it was put --
  // the "Now playing" pill and `n` are how you get back.
  //
  // It also covers a race the naive version loses: at library size the active
  // index can arrive before the chunk holding that row does, and scrolling to a
  // row the virtualiser does not have yet is a no-op that never retries. Rows
  // are a dependency, so the jump happens when the row exists.
  const followedIndex = useRef(-1)

  useEffect(() => {
    if (!canFollowPlayback || !followPlayback) return
    if (activeIndex < 0 || activeIndex >= rows.length) return
    if (followedIndex.current === activeIndex) return

    followedIndex.current = activeIndex
    // Centred every time, in both directions. Minimal scrolling brings a row in
    // from whichever edge it crossed and leaves it there, so going forwards
    // parked the track on the status bar and going backwards tucked it under the
    // sticky toolbar. Centre has no edge to land on, so where the playing track
    // sits becomes a fact rather than a consequence of how you got there.
    scrollToTrack(activeIndex, { align: 'center', animate: true })
  }, [activeIndex, rows.length, canFollowPlayback, followPlayback, scrollToTrack])

  useKeymap(
    SCOPE.playlist,
    {
      ...(onOpenFinder ? { openFinder: onOpenFinder } : null),
      cursorDown: () => keyMove(1),
      cursorUp: () => keyMove(-1),
      cursorPageDown: () => keyMove(PAGE),
      cursorPageUp: () => keyMove(-PAGE),
      cursorTop: () => keyMoveTo(0),
      cursorBottom: () => keyMoveTo(rows.length - 1),
      playCursor: () => play(selection.cursor),
      jumpToPlaying: () => {
        if (activeIndex < 0) return
        moveCursorTo(activeIndex)
        scrollToTrack(activeIndex, { align: 'center', animate: true })
      },
      extendDown: () => keyMove(1, { extend: true }),
      extendUp: () => keyMove(-1, { extend: true }),
      selectAll: selection.selectAll,
      clearSelection: selection.clear,
      toggleLayout: () => setLayout((current) => (current === 'compact' ? 'album' : 'compact')),
      toggleHeat: () => setShowHeat((current) => !current),
    },
    { enabled: keysEnabled && rows.length > 0 },
  )

  // Held so the arrow does not flip mid-exit: while the pill animates away its
  // direction is already null.
  if (activeDirection) lastDirection.current = activeDirection
  const shownDirection = activeDirection ?? lastDirection.current

  return (
    <div className={styles.view}>
      {header}

      <div className={styles.toolbar}>
        {toolbarLeading}

        <span className={styles.spacer} />

        {hasPlayCounts ? (
          <Menu
            isOpen={isHeatInfoOpen}
            onDismiss={dismissHeatInfo}
            role="dialog"
            className={styles.heatInfo}
            trigger={
              <Button
                icon={Flame}
                aria-pressed={showHeat}
                aria-label="Show play-count heat"
                title="Play-count heat"
                onClick={() => {
                  setShowHeat((current) => !current)
                  // Reaching for the control counts as having met it.
                  if (isHeatInfoOpen) dismissHeatInfo()
                }}
              />
            }
          >
            <HeatLegend onDismiss={dismissHeatInfo} />
          </Menu>
        ) : null}

        <Segmented value={layout} onChange={setLayout} options={LAYOUTS} label="Track layout" />

        <ColumnsMenu
          isOpen={isColumnsOpen}
          onOpenChange={setIsColumnsOpen}
          enabledIds={enabledIds}
          isAvailable={isAvailable}
          onExplainHeat={
            hasPlayCounts
              ? () => {
                  setIsColumnsOpen(false)
                  setIsHeatInfoOpen(true)
                }
              : undefined
          }
          showArtwork={showArtwork}
          onToggleArtwork={() => setShowArtwork((current) => !current)}
          onToggleColumn={(id) =>
            setEnabledIds((current) =>
              current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
            )
          }
        />
      </div>

      {isLoading ? (
        <div className={styles.progress} style={{ transform: `scaleX(${total ? loaded / total : 0})` }} />
      ) : null}

      {rows.length === 0 ? (
        isLoading ? null : <p className={styles.notice}>{emptyNotice}</p>
      ) : (
        <div
          className={styles.rows}
          {...mergeHandlers(trackMenu.triggerProps, trackDrag.dragProps, {
            onPointerDown: (event) => {
              pointerType.current = event.pointerType
            },
            onPointerUp: resolveCollapse,
            onClick: onRowsClick,
            onDoubleClick: onRowsDoubleClick,
          })}
        >
          <TrackList
            ref={listRef}
            rows={rows}
            groups={groups}
            indices={indices}
            source={source}
            scrollRef={scrollRef}
            layout={layout}
            columns={optional}
            template={template}
            albumTemplate={albumTemplate}
            showArtwork={showArtwork}
            heat={heat}
            patina={patina}
            showHeat={showHeat}
            activeIndex={activeIndex}
            isPlaying={isPlaying}
            cursor={selection.cursor}
            selection={selection.selection}
            matches={matches}
            onSelect={selectFromPointer}
            onActiveDirectionChange={setActiveDirection}
            isCompactViewport={isCompactViewport}
          />
        </div>
      )}

      {trackMenu.element}

      {/* Stays mounted so it can animate out as well as in. The slot has no
          height, so nothing is reserved at the end of the list while hidden. */}
      {activeIndex >= 0 ? (
        <div className={styles.pillSlot} aria-hidden={!activeDirection}>
          <button
            type="button"
            className={styles.pill}
            data-visible={Boolean(activeDirection)}
            data-direction={shownDirection}
            tabIndex={activeDirection ? 0 : -1}
            onClick={() => scrollToTrack(activeIndex, { align: 'center', animate: true })}
          >
            {shownDirection === 'up' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            Now playing
          </button>
        </div>
      ) : null}
    </div>
  )
})
