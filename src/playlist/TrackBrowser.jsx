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
// `rows` is the view; `indices` maps a position in it back to the playlist
// index the player knows about, and is null when the two are the same thing.
// Selection, the cursor and heat are all in view space -- only artwork and
// playback cross back over.
export const TrackBrowser = forwardRef(function TrackBrowser(
  {
    rows,
    indices = null,
    playlistId,
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

  const { optional, template, albumTemplate } = useMemo(
    () => resolveColumns({ enabledIds, showArtwork, isCompactViewport, isAvailable }),
    [enabledIds, showArtwork, isCompactViewport, isAvailable],
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
    playlistId,
    selection: selection.selection,
    onSelectOnly: moveCursorTo,
  })

  const trackDrag = useTrackDragSource({
    rows,
    indices,
    playlistId,
    selection: selection.selection,
  })

  // Pressing inside a multi-track selection must not collapse it on the way
  // down: this could be the start of a drag of all of them, and Finder, Explorer
  // and every file manager since defer that decision to the release. Without it
  // a multi-track drag is impossible -- the selection is gone before the pointer
  // has moved a pixel.
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
            onPointerUp: resolveCollapse,
          })}
        >
          <TrackList
            ref={listRef}
            rows={rows}
            indices={indices}
            viewKey={viewKey}
            playlistId={playlistId}
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
            onPlay={play}
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
