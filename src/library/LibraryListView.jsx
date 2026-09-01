import { useCallback, useMemo, useRef } from 'react'
import { Shuffle } from 'lucide-react'

import { playItem, readTrack } from '../api/beefweb.js'
import { usePlaybackOrder, usePlayer } from '../player/usePlayer.js'
import { Mosaic } from '../playlist/Mosaic.jsx'
import { TrackBrowser } from '../playlist/TrackBrowser.jsx'
import { ViewHeader } from '../playlist/ViewHeader.jsx'
import { summarise } from '../playlist/stats.js'
import { useAvailableFields } from '../playlist/useAvailableFields.js'
import { useFinder } from '../playlist/useFinder.jsx'
import { Button } from '../ui/Button.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import { SCRATCH_KIND } from './jeanPlaylists.js'
import { useScratchPlaylist } from './useScratchPlaylist.js'
import styles from './LibraryListView.module.css'

// One list, whatever filtered it. All Music is the no-filter view; a shelf is
// the same thing with a preset. Both are shells over the library array, and
// neither is a playlist -- playback is materialised into the scratch only when
// somebody presses play, which is what keeps browsing free.
export function LibraryListView({
  library,
  view,
  kind,
  label,
  title,
  eyebrow,
  playlists,
  scrollRef,
  isCompactViewport,
  emptyNotice,
}) {
  const browserRef = useRef(null)
  const { data: playerSnapshot } = usePlayer()
  const order = usePlaybackOrder()

  const { rows, indices, heat, patina, playedCount } = view
  const { hasPlayCounts } = useAvailableFields(rows)
  const stats = useMemo(() => summarise(rows, playedCount), [rows, playedCount])

  // Named for what it is searching, because the top bar has a search of its own
  // two centimetres above and the two do different things: that one filters the
  // library down to matches, this one walks you to a track without disturbing a
  // row. All Music is where it matters most -- 30,441 rows is not something
  // anyone scrolls looking for a record.
  const finder = useFinder({
    rows,
    browserRef,
    label: kind === SCRATCH_KIND.all ? 'Find in all music' : 'Find in this shelf',
  })

  const canWrite = playerSnapshot?.player?.permissions?.changePlaylists === true

  const scratch = useScratchPlaylist({ playlists, canEdit: canWrite })
  const holdsThisView = scratch.holdsView(kind, label, indices.length)

  // Which row is playing. The scratch answers for free when it holds this view;
  // otherwise the source finds it by identity, so a track playing from some
  // other set is still marked here, in its own position.
  const activeItem = playerSnapshot?.player?.activeItem
  const playing = readTrack(playerSnapshot?.player)
  const playingPath = playing?.path ?? null
  const playingSubsong = playing?.subsong ?? 0
  const activePlaylistId = activeItem?.playlistId ?? null
  const activeItemIndex = activeItem?.index ?? -1
  const scratchId = scratch.playlist?.id ?? null

  const activePosition = useMemo(() => {
    if (holdsThisView && activePlaylistId === scratchId) return activeItemIndex
    return library.source.playingPosition(
      indices,
      { path: playingPath, subsong: playingSubsong },
      { playlistId: activePlaylistId, index: activeItemIndex },
    )
  }, [
    holdsThisView,
    scratchId,
    library.source,
    indices,
    playingPath,
    playingSubsong,
    activePlaylistId,
    activeItemIndex,
  ])

  const play = useCallback(
    async (position) => {
      const id = await scratch.ensure({ kind, label, refs: indices, source: library.source })
      // No scratch playlist means a player that will not let Jean make one. The
      // track still plays, in place, and what follows it is the library's
      // business rather than this view's -- degraded, and honestly so.
      if (id) playItem(id, position)
      else if (library.playlist) playItem(library.playlist.id, indices[position])
    },
    [library.source, library.playlist, indices, scratch, kind, label],
  )

  const shufflePlay = useCallback(() => {
    if (rows.length === 0) return
    order.enableShuffle()
    browserRef.current?.play(Math.floor(Math.random() * rows.length))
  }, [order, rows.length])

  if (library.error) {
    return <p className={styles.notice}>Could not read your library -- {library.error.message}</p>
  }

  return (
    <TrackBrowser
      ref={browserRef}
      rows={rows}
      indices={indices}
      source={library.source}
      viewKey={`${kind}:${label}`}
      heat={heat}
      patina={patina}
      activeIndex={activePosition}
      isPlaying={playerSnapshot?.player?.playbackState === 'playing'}
      matches={finder.matches}
      keysEnabled={!finder.isFinding}
      isLoading={library.isLoading}
      loaded={library.loaded}
      total={library.total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      // Unlike search, these rows do not change under every keystroke, so
      // following playback is safe and is what makes opening a shelf land on
      // the track it just started.
      canFollowPlayback
      onPlay={play}
      onOpenFinder={finder.open}
      toolbarLeading={finder.toolbarLeading}
      emptyNotice={emptyNotice}
      header={
        <ViewHeader
          eyebrow={eyebrow}
          title={title}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={
            <Mosaic
              source={library.source}
              trackCount={rows.length}
              indices={indices}
              seed={`${kind}:${label}`}
            />
          }
          actions={
            <>
              <Button
                variant="primary"
                icon={PlayIcon}
                onClick={() => browserRef.current?.play(0)}
                disabled={rows.length === 0}
              >
                Play
              </Button>
              {canWrite ? (
                <Button
                  icon={Shuffle}
                  onClick={shufflePlay}
                  disabled={rows.length === 0 || !order.canShuffle}
                >
                  Shuffle
                </Button>
              ) : null}
            </>
          }
        />
      }
    />
  )
}
