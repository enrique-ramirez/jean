import { useMemo, useRef } from 'react'

import { useIsPlaying, usePermissions } from '../player/usePlayer.js'
import { Mosaic } from '../playlist/Mosaic.jsx'
import { PlayActions } from '../playlist/PlayActions.jsx'
import { TrackBrowser } from '../playlist/TrackBrowser.jsx'
import { ViewHeader } from '../playlist/ViewHeader.jsx'
import { summarise } from '../playlist/stats.js'
import { useAvailableFields } from '../playlist/useAvailableFields.js'
import { useFinder } from '../playlist/useFinder.jsx'
import { SCRATCH_KIND } from './jeanPlaylists.js'
import { useActivePosition } from './useActivePosition.js'
import { usePlaySet } from './usePlaySet.js'
import styles from './LibraryListView.module.css'

// One list, whatever filtered it. All music is the no-filter view; a shelf is
// the same thing with a preset. Both are shells over the library array and
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
  const { rows, indices, heat, patina, playedCount } = view

  const isPlaying = useIsPlaying()
  // Strictly true, not merely "not false": without the permission there is no
  // scratch playlist to make, so Shuffle would be shuffling the whole library
  // rather than this view. Better absent until the player has said yes.
  const canWrite = usePermissions().changePlaylists === true

  const { hasPlayCounts } = useAvailableFields(rows)
  const stats = useMemo(() => summarise(rows, playedCount), [rows, playedCount])

  // Named for what it is searching, because the top bar has a search of its own
  // two centimetres above and the two do different things: that one filters the
  // library down to matches, this one walks you to a track without disturbing a
  // row. All music is where it matters most -- a whole library is not something
  // anyone scrolls looking for a record.
  const finder = useFinder({
    rows,
    browserRef,
    label: kind === SCRATCH_KIND.all ? 'Find in all music' : 'Find in this shelf',
  })

  const { play, scratch } = usePlaySet({ library, playlists })
  const holdsThisView = scratch.holdsView(kind, label, indices.length)

  const activeIndex = useActivePosition({
    source: library.source,
    indices,
    scratch,
    holdsThisView,
  })

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
      activeIndex={activeIndex}
      isPlaying={isPlaying}
      matches={finder.matches}
      keysEnabled={!finder.isFinding}
      isLoading={library.isLoading}
      loaded={library.loaded}
      total={library.total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      // Unlike search, these rows do not change under every keystroke, so
      // following playback is safe -- and it is what makes opening a shelf land
      // on the track it just started.
      canFollowPlayback
      onPlay={(position) => play({ kind, label, refs: indices, position })}
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
            <PlayActions browserRef={browserRef} trackCount={rows.length} canShuffle={canWrite} />
          }
        />
      }
    />
  )
}
