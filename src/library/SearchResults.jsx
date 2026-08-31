import { useCallback, useMemo, useRef, useState } from 'react'
import { Search, Shuffle } from 'lucide-react'

import { playItem } from '../api/beefweb.js'
import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { useActiveItem, usePlaybackOrder, usePlayer } from '../player/usePlayer.js'
import { Mosaic } from '../playlist/Mosaic.jsx'
import { TrackBrowser } from '../playlist/TrackBrowser.jsx'
import { ViewHeader } from '../playlist/ViewHeader.jsx'
import { summarise } from '../playlist/stats.js'
import { useAvailableFields } from '../playlist/useAvailableFields.js'
import { Button } from '../ui/Button.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import { LibraryPicker, LibrarySetup } from './LibrarySetup.jsx'
import { SavePlaylistButton } from './SavePlaylistButton.jsx'
import { positionOf } from './libraryIndex.js'
import { useScratchPlaylist } from './useScratchPlaylist.js'
import styles from './SearchResults.module.css'

// A view over the library, never a playlist. Nothing here is created, cleared
// or written: playing a result plays it where it already lives, by index, in
// the playlist the library is.
export function SearchResults({ search, playlists, scrollRef, isCompactViewport, onOpenPlaylist }) {
  const browserRef = useRef(null)
  const [isPicking, setIsPicking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const { data: playerSnapshot } = usePlayer()
  const order = usePlaybackOrder()

  const { rows, indices, heat, patina, playedCount } = search.results
  const { hasPlayCounts } = useAvailableFields(rows)

  const stats = useMemo(() => summarise(rows, playedCount), [rows, playedCount])

  // A read-only instance gets a read-only Jean: no button that would 403.
  const canSavePlaylists = playerSnapshot?.player?.permissions?.changePlaylists === true

  const scratch = useScratchPlaylist({
    playlists,
    query: search.query,
    count: indices.length,
    canEdit: canSavePlaylists,
  })

  // Two playlists are in play at once and they must not be confused. Reading
  // stays with the library -- the rows, their artwork, their heat all come from
  // it -- while playback moves into the scratch playlist, whose contents are
  // these results in this order. So a position is a position there, and the
  // indices mapping is only needed for the library side.
  const scratchItem = useActiveItem(scratch.playlist?.id)
  const libraryItem = useActiveItem(search.playlist?.id)
  const activePosition = scratch.holdsCurrentView
    ? (scratchItem?.index ?? -1)
    : positionOf(indices, libraryItem?.index)

  useKeymap(
    SCOPE.search,
    { saveSearch: () => setIsSaving(true) },
    { enabled: canSavePlaylists && rows.length > 0 && !search.isLoading },
  )


  // Materialised on play, never on typing: browsing and refining stay entirely
  // client-side, and the player only hears about a result set once someone
  // actually asks to hear it.
  const play = useCallback(
    async (position) => {
      const scratchId = await scratch.ensure({ source: search.source, indices })
      // No scratch playlist means a player that will not let us make one. On
      // the fallback the track still plays, in place, and what follows it is
      // the library's business rather than these results'. With the media
      // library API there is no playlist to play in place *in*, so there is
      // nothing to fall back to.
      if (scratchId) playItem(scratchId, position)
      else if (search.playlist) playItem(search.playlist.id, indices[position])
    },
    [search.source, search.playlist, indices, scratch, search.query],
  )

  const shufflePlay = useCallback(() => {
    if (rows.length === 0) return
    order.enableShuffle()
    browserRef.current?.play(Math.floor(Math.random() * rows.length))
  }, [order, rows.length])

  if (search.needsSetup) {
    return <LibrarySetup playlists={playlists} onChoose={search.choose} />
  }

  if (search.error) {
    return <p className={styles.notice}>Could not read your library -- {search.error.message}</p>
  }

  if (!search.hasQuery) {
    return (
      <div className={styles.idle}>
        <Search size={26} strokeWidth={1.5} aria-hidden="true" />
        <h1 className={styles.idleTitle}>Search your library</h1>
        <p className={styles.idleBody}>
          {/* With the media library API there is no playlist standing in for
              the library, so there is nothing to name and nothing to swap. */}
          {search.playlist ? (
            <>
              {search.playlist.itemCount.toLocaleString()} tracks in <b>{search.playlist.title}</b>.{' '}
            </>
          ) : (
            <>{search.total.toLocaleString()} tracks in your library. </>
          )}
          Title, artist and album, as you type -- every word has to match, in any order.
        </p>
        <Button variant="primary" icon={Search} onClick={search.focus}>
          Start typing
        </Button>
        {search.playlist ? (
          <button
            type="button"
            className={styles.link}
            aria-expanded={isPicking}
            onClick={() => setIsPicking((current) => !current)}
          >
            Search a different playlist
          </button>
        ) : null}
        {isPicking && search.playlist ? (
          <LibraryPicker
            playlists={playlists}
            currentId={search.playlist.id}
            onChoose={(playlist) => {
              search.choose(playlist)
              setIsPicking(false)
            }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <TrackBrowser
      ref={browserRef}
      rows={rows}
      indices={indices}
      source={search.source}
      viewKey={search.viewKey}
      heat={heat}
      patina={patina}
      activeIndex={activePosition}
      isPlaying={playerSnapshot?.player?.playbackState === 'playing'}
      isLoading={search.isLoading}
      loaded={search.loaded}
      total={search.total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      keysEnabled={!search.isFocused}
      onPlay={play}
      // The library search is this list's filter, so `/` belongs to the field
      // rather than to a second finder nested inside the results.
      onOpenFinder={search.focus}
      emptyNotice="Nothing in your library matches that."
      header={
        <ViewHeader
          eyebrow={`Search results in ${search.playlist?.title ?? 'your library'}`}
          title={search.query}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={
            <Mosaic
              source={search.source}
              trackCount={rows.length}
              indices={indices}
              seed={search.viewKey}
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
              {/* Shuffle belongs here again now that the results become a real
                  playlist when they are played: the order draws from that, so
                  it shuffles these matches and nothing else. Without the
                  permission to make one it would be back to shuffling the whole
                  library, so it goes when that goes. */}
              {canSavePlaylists ? (
                <Button
                  icon={Shuffle}
                  onClick={shufflePlay}
                  disabled={rows.length === 0 || !order.canShuffle}
                >
                  Shuffle
                </Button>
              ) : null}
              {canSavePlaylists ? (
                <SavePlaylistButton
                  search={search}
                  scratch={scratch}
                  isOpen={isSaving}
                  onOpenChange={setIsSaving}
                  onOpenPlaylist={onOpenPlaylist}
                />
              ) : null}
            </>
          }
        />
      }
      toolbarLeading={
        <p className={styles.summary}>
          {search.isLoading
            ? `Searching ${search.loaded.toLocaleString()} of ${search.total.toLocaleString()}...`
            : `${search.matchCount.toLocaleString()} ${search.matchCount === 1 ? 'match' : 'matches'}`}
        </p>
      }
    />
  )
}
