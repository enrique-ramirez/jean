import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Flame, LayoutList, ListMusic, Search } from 'lucide-react'

import { playItem } from '../api/beefweb.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { useActiveItem, usePlaybackOrder, usePlayer } from '../player/usePlayer.js'
import { Button } from '../ui/Button.jsx'
import { Segmented } from '../ui/Segmented.jsx'
import { ColumnsMenu } from './ColumnsMenu.jsx'
import { Finder } from './Finder.jsx'
import { PlaylistHeader } from './PlaylistHeader.jsx'
import { TrackList } from './TrackList.jsx'
import { DEFAULT_COLUMN_IDS, resolveColumns } from './columns.js'
import { FIELD, fieldIsAvailable } from './fields.js'
import { summarise } from './stats.js'
import { search, useSearchIndex } from './useSearchIndex.js'
import { useTrackSelection } from './useTrackSelection.js'
import { usePlaylistItems } from './usePlaylistItems.js'
import styles from './PlaylistView.module.css'

const LAYOUTS = [
  { value: 'compact', label: 'List', icon: LayoutList },
  { value: 'album', label: 'Albums', icon: ListMusic },
]

export function PlaylistView({ playlist, scrollRef, isCompactViewport }) {
  const { rows, loaded, total, isLoading, error, heat, patina, playedCount } = usePlaylistItems(
    playlist?.id,
    playlist?.itemCount,
  )

  const listRef = useRef(null)
  const { data: playerSnapshot } = usePlayer()
  const activeItem = useActiveItem(playlist?.id)
  const shuffle = usePlaybackOrder()
  const isPlaying = playerSnapshot?.player?.playbackState === 'playing'

  const [layout, setLayout] = useStoredState('jean.layout', 'compact')
  const [showHeat, setShowHeat] = useStoredState('jean.heat', true)
  const [showArtwork, setShowArtwork] = useStoredState('jean.artwork', true)
  const [enabledIds, setEnabledIds] = useStoredState('jean.columns', DEFAULT_COLUMN_IDS)

  const [isColumnsOpen, setIsColumnsOpen] = useState(false)
  const [isFinding, setIsFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [activeDirection, setActiveDirection] = useState(null)
  const lastDirection = useRef('down')

  const selection = useTrackSelection(rows.length)

  // Sampled once per row set rather than per column per render. This is the
  // capability probe: a field the player cannot resolve returns '?' everywhere.
  const availableFields = useMemo(() => {
    const available = new Set()
    for (const field of Object.values(FIELD)) {
      if (fieldIsAvailable(rows, field)) available.add(field)
    }
    return available
  }, [rows])

  const isAvailable = useCallback((field) => availableFields.has(field), [availableFields])
  const hasPlayCounts = availableFields.has(FIELD.playCount)

  const { optional, template, albumTemplate } = useMemo(
    () => resolveColumns({ enabledIds, showArtwork, isCompactViewport, isAvailable }),
    [enabledIds, showArtwork, isCompactViewport, isAvailable],
  )

  const stats = useMemo(
    // itemCount rather than rows.length: the header should state what the
    // playlist holds, not how much of it has arrived.
    () => ({ ...summarise(rows, playedCount), trackCount: playlist?.itemCount ?? rows.length }),
    [rows, playedCount, playlist?.itemCount],
  )

  const haystacks = useSearchIndex(rows, isFinding)
  const { matches, results } = useMemo(() => search(haystacks, query), [haystacks, query])

  const scrollToTrack = useCallback((index, options) => {
    listRef.current?.scrollToTrack(index, options)
  }, [])

  const { moveCursorTo, moveCursor } = selection

  const play = useCallback(
    (index) => {
      moveCursorTo(index)
      playItem(playlist.id, index)
    },
    [playlist?.id, moveCursorTo],
  )

  const previewTrack = useCallback(
    (index) => {
      moveCursorTo(index)
      listRef.current?.scrollToTrack(index, { align: 'center' })
    },
    [moveCursorTo],
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
    (index) => {
      pendingScroll.current = true
      moveCursorTo(index)
    },
    [moveCursorTo],
  )

  useEffect(() => {
    if (!pendingScroll.current) return
    pendingScroll.current = false
    scrollToTrack(selection.cursor, { align: 'auto' })
  }, [selection.cursor, scrollToTrack])

  const closeFinder = useCallback(() => {
    setIsFinding(false)
    setQuery('')
  }, [])

  useKeymap(
    SCOPE.playlist,
    {
      openFinder: () => setIsFinding(true),
      cursorDown: () => keyMove(1),
      cursorUp: () => keyMove(-1),
      cursorPageDown: () => keyMove(12),
      cursorPageUp: () => keyMove(-12),
      cursorTop: () => keyMoveTo(0),
      cursorBottom: () => keyMoveTo(rows.length - 1),
      playCursor: () => play(selection.cursor),
      jumpToPlaying: () => {
        if (activeItem) {
          moveCursorTo(activeItem.index)
          scrollToTrack(activeItem.index, { align: 'center', animate: true })
        }
      },
      extendDown: () => keyMove(1, { extend: true }),
      extendUp: () => keyMove(-1, { extend: true }),
      selectAll: selection.selectAll,
      clearSelection: selection.clear,
      toggleLayout: () => setLayout((current) => (current === 'compact' ? 'album' : 'compact')),
      toggleHeat: () => setShowHeat((current) => !current),
    },
    { enabled: !isFinding && rows.length > 0 },
  )

  if (!playlist) {
    return <p className={styles.notice}>Select a playlist to begin.</p>
  }

  if (error) {
    return <p className={styles.notice}>Could not load this playlist -- {error.message}</p>
  }

  const activeIndex = activeItem?.index ?? -1

  // Held so the arrow does not flip mid-exit: while the pill animates away its
  // direction is already null.
  if (activeDirection) lastDirection.current = activeDirection
  const shownDirection = activeDirection ?? lastDirection.current

  return (
    <div className={styles.view}>
      <PlaylistHeader
        playlist={playlist}
        stats={stats}
        hasPlayCounts={hasPlayCounts}
        canPlay={rows.length > 0}
        onPlay={() => play(0)}
        shuffle={shuffle}
      />

      <div className={styles.toolbar}>
        {isFinding ? (
          <Finder
            rows={rows}
            results={results}
            matches={matches}
            query={query}
            onQueryChange={setQuery}
            onPreview={previewTrack}
            onConfirm={(index) => {
              play(index)
              scrollToTrack(index, { align: 'center' })
              closeFinder()
            }}
            onClose={closeFinder}
          />
        ) : (
          <Button icon={Search} onClick={() => setIsFinding(true)}>
            Find in playlist
            <kbd className={styles.hint}>/</kbd>
          </Button>
        )}

        <span className={styles.spacer} />

        {hasPlayCounts ? (
          <Button
            icon={Flame}
            aria-pressed={showHeat}
            aria-label="Show play-count heat"
            title="Play-count heat"
            onClick={() => setShowHeat((current) => !current)}
          />
        ) : null}

        <Segmented value={layout} onChange={setLayout} options={LAYOUTS} label="Track layout" />

        <ColumnsMenu
          isOpen={isColumnsOpen}
          onOpenChange={setIsColumnsOpen}
          enabledIds={enabledIds}
          isAvailable={isAvailable}
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

      {rows.length === 0 && !isLoading ? (
        <p className={styles.notice}>This playlist is empty.</p>
      ) : (
        <TrackList
          ref={listRef}
          rows={rows}
          playlistId={playlist.id}
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
          onSelect={selection.selectFromEvent}
          onPlay={play}
          onActiveDirectionChange={setActiveDirection}
          isCompactViewport={isCompactViewport}
        />
      )}

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
}
