import { useMemo, useRef } from 'react'

import { playItem } from '../api/beefweb.js'
import { librarySourceOf } from '../library/librarySource.js'
import { useActiveItem, useIsPlaying } from '../player/usePlayer.js'
import { Mosaic } from './Mosaic.jsx'
import { PlayActions } from './PlayActions.jsx'
import { TrackBrowser } from './TrackBrowser.jsx'
import { ViewHeader } from './ViewHeader.jsx'
import { summarise } from './stats.js'
import { useAvailableFields } from './useAvailableFields.js'
import { useFinder } from './useFinder.jsx'
import { usePlaylistItems } from './usePlaylistItems.js'
import styles from './PlaylistView.module.css'

export function PlaylistView({ playlist, scrollRef, isCompactViewport }) {
  const { rows, loaded, total, isLoading, error, heat, patina, playedCount } = usePlaylistItems(
    playlist?.id,
    playlist?.itemCount,
  )

  // A playlist is addressed by index whatever the media library situation is:
  // playlists are playlists, and the library source only ever stands in for the
  // *library*.
  const source = useMemo(
    () => librarySourceOf({ kind: 'playlist', playlistId: playlist?.id }),
    [playlist?.id],
  )

  const browserRef = useRef(null)
  const isPlaying = useIsPlaying()
  const activeItem = useActiveItem(playlist?.id)
  const { hasPlayCounts } = useAvailableFields(rows)

  const finder = useFinder({ rows, browserRef, label: 'Find in this playlist' })

  const stats = useMemo(
    // itemCount rather than rows.length: the header should state what the
    // playlist holds, not how much of it has arrived.
    () => ({ ...summarise(rows, playedCount), trackCount: playlist?.itemCount ?? rows.length }),
    [rows, playedCount, playlist?.itemCount],
  )

  if (!playlist) return <p className={styles.notice}>Select a playlist to begin.</p>

  if (error) {
    return <p className={styles.notice}>Could not load this playlist -- {error.message}</p>
  }

  return (
    <TrackBrowser
      ref={browserRef}
      rows={rows}
      source={source}
      viewKey={`playlist:${playlist.id}`}
      heat={heat}
      patina={patina}
      activeIndex={activeItem?.index ?? -1}
      isPlaying={isPlaying}
      matches={finder.matches}
      isLoading={isLoading}
      loaded={loaded}
      total={total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      keysEnabled={!finder.isFinding}
      canFollowPlayback
      // In place, by index. Nothing is written: the playlist already is the set.
      onPlay={(index) => playItem(playlist.id, index)}
      onOpenFinder={finder.open}
      emptyNotice="This playlist is empty."
      header={
        <ViewHeader
          eyebrow={playlist.isCurrent ? 'Playing from' : 'Playlist'}
          title={playlist.title}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={<Mosaic source={source} trackCount={stats.trackCount} seed={playlist.id} />}
          actions={<PlayActions browserRef={browserRef} trackCount={rows.length} />}
        />
      }
      toolbarLeading={finder.toolbarLeading}
    />
  )
}
