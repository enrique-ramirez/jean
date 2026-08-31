import { useCallback, useMemo, useRef, useState } from 'react'
import { Search, Shuffle } from 'lucide-react'

import { playItem } from '../api/beefweb.js'
import { useActiveItem, usePlaybackOrder, usePlayer } from '../player/usePlayer.js'
import { Button } from '../ui/Button.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import { Finder } from './Finder.jsx'
import { Mosaic } from './Mosaic.jsx'
import { TrackBrowser } from './TrackBrowser.jsx'
import { ViewHeader } from './ViewHeader.jsx'
import { summarise } from './stats.js'
import { search, useSearchIndex } from './useSearchIndex.js'
import { useAvailableFields } from './useAvailableFields.js'
import { usePlaylistItems } from './usePlaylistItems.js'
import styles from './PlaylistView.module.css'

export function PlaylistView({ playlist, scrollRef, isCompactViewport }) {
  const { rows, loaded, total, isLoading, error, heat, patina, playedCount } = usePlaylistItems(
    playlist?.id,
    playlist?.itemCount,
  )

  const browserRef = useRef(null)
  const { data: playerSnapshot } = usePlayer()
  const activeItem = useActiveItem(playlist?.id)
  const shuffle = usePlaybackOrder()
  const { hasPlayCounts } = useAvailableFields(rows)

  const [isFinding, setIsFinding] = useState(false)
  const [query, setQuery] = useState('')

  const stats = useMemo(
    // itemCount rather than rows.length: the header should state what the
    // playlist holds, not how much of it has arrived.
    () => ({ ...summarise(rows, playedCount), trackCount: playlist?.itemCount ?? rows.length }),
    [rows, playedCount, playlist?.itemCount],
  )

  const haystacks = useSearchIndex(rows, isFinding)
  const { matches, results } = useMemo(() => search(haystacks, query), [haystacks, query])

  const play = useCallback((index) => playItem(playlist.id, index), [playlist?.id])

  const closeFinder = useCallback(() => {
    setIsFinding(false)
    setQuery('')
  }, [])

  if (!playlist) {
    return <p className={styles.notice}>Select a playlist to begin.</p>
  }

  if (error) {
    return <p className={styles.notice}>Could not load this playlist -- {error.message}</p>
  }

  return (
    <TrackBrowser
      ref={browserRef}
      rows={rows}
      playlistId={playlist.id}
      viewKey={`playlist:${playlist.id}`}
      heat={heat}
      patina={patina}
      activeIndex={activeItem?.index ?? -1}
      isPlaying={playerSnapshot?.player?.playbackState === 'playing'}
      matches={matches}
      isLoading={isLoading}
      loaded={loaded}
      total={total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      keysEnabled={!isFinding}
      canFollowPlayback
      onPlay={play}
      onOpenFinder={() => setIsFinding(true)}
      emptyNotice="This playlist is empty."
      header={
        <ViewHeader
          eyebrow={playlist.isCurrent ? 'Playing from' : 'Playlist'}
          title={playlist.title}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={<Mosaic playlistId={playlist.id} trackCount={stats.trackCount} />}
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
              <Button
                icon={Shuffle}
                onClick={shuffle.toggleShuffle}
                disabled={!shuffle.canShuffle}
                aria-pressed={shuffle.isShuffle}
                title={shuffle.orderName ? `Playback order: ${shuffle.orderName}` : 'Shuffle'}
              >
                Shuffle
              </Button>
            </>
          }
        />
      }
      toolbarLeading={
        isFinding ? (
          <Finder
            rows={rows}
            results={results}
            matches={matches}
            query={query}
            onQueryChange={setQuery}
            onPreview={(index) => browserRef.current?.preview(index)}
            onConfirm={(index) => {
              browserRef.current?.play(index)
              browserRef.current?.scrollToTrack(index, { align: 'center' })
              closeFinder()
            }}
            onClose={closeFinder}
          />
        ) : (
          <Button icon={Search} onClick={() => setIsFinding(true)}>
            Find in playlist
            <kbd className={styles.hint}>/</kbd>
          </Button>
        )
      }
    />
  )
}
