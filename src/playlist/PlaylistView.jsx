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
  const order = usePlaybackOrder()
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

  // Start somewhere at random and let the player take it from there.
  //
  // Measured against the live player: POST /player/play/{plref}/{index} makes
  // that playlist the active one, and Shuffle (tracks) then draws its next
  // track from it -- p5 index 3, then 953, 540, 218, never leaving p5. So the
  // mode is the shuffling, and this only has to open the door for it.
  //
  // The queue was the other candidate and is worse: beefweb takes one request
  // per item with no bulk form, so a playlist of any size means hundreds of
  // calls and a lookahead cap nobody can see the edge of, and it would have to
  // clobber whatever the user had queued to mean anything.
  const shufflePlay = useCallback(() => {
    if (rows.length === 0) return
    order.enableShuffle()
    browserRef.current?.play(Math.floor(Math.random() * rows.length))
  }, [order, rows.length])

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
              {/* An action, not the mode -- the mode moved to the status bar,
                  where global player state belongs. Next to Play this reads as
                  "play these, shuffled", so that is what it does: a random
                  track now, and shuffle on for everything after it. */}
              <Button
                icon={Shuffle}
                onClick={shufflePlay}
                disabled={rows.length === 0 || !order.canShuffle}
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
