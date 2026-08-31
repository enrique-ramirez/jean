import { useCallback, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { playItem } from '../api/beefweb.js'
import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { useActiveItem, usePlayer } from '../player/usePlayer.js'
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
import styles from './SearchResults.module.css'

// A view over the library, never a playlist. Nothing here is created, cleared
// or written: playing a result plays it where it already lives, by index, in
// the playlist the library is.
export function SearchResults({ search, playlists, scrollRef, isCompactViewport, onOpenPlaylist }) {
  const browserRef = useRef(null)
  const [isPicking, setIsPicking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const { data: playerSnapshot } = usePlayer()
  const activeItem = useActiveItem(search.playlist?.id)

  const { rows, indices, heat, patina, playedCount } = search.results
  const { hasPlayCounts } = useAvailableFields(rows)

  const stats = useMemo(() => summarise(rows, playedCount), [rows, playedCount])
  const activePosition = useMemo(
    () => positionOf(indices, activeItem?.index),
    [indices, activeItem?.index],
  )

  // A read-only instance gets a read-only Jean: no button that would 403.
  const canSavePlaylists = playerSnapshot?.player?.permissions?.changePlaylists === true

  useKeymap(
    SCOPE.search,
    { saveSearch: () => setIsSaving(true) },
    { enabled: canSavePlaylists && rows.length > 0 && !search.isLoading },
  )

  const libraryId = search.playlist?.id
  const play = useCallback(
    (position) => playItem(libraryId, indices[position]),
    [libraryId, indices],
  )

  if (!search.playlist) {
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
          {search.playlist.itemCount.toLocaleString()} tracks in <b>{search.playlist.title}</b>.
          Title, artist and album, as you type -- every word has to match, in any order.
        </p>
        <Button variant="primary" icon={Search} onClick={search.focus}>
          Start typing
        </Button>
        <button
          type="button"
          className={styles.link}
          aria-expanded={isPicking}
          onClick={() => setIsPicking((current) => !current)}
        >
          Search a different playlist
        </button>
        {isPicking ? (
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
      playlistId={search.playlist.id}
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
          eyebrow={`Search results in ${search.playlist.title}`}
          title={search.query}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={
            <Mosaic
              playlistId={search.playlist.id}
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
              {/* No Shuffle here, deliberately. Shuffle is the player's
                  playback order and it draws from the active playlist -- and
                  these results are a view over one, not a playlist of their
                  own. Turning it on would start inside the results and then
                  wander the whole library, which is not what a button sitting
                  above 21 matches appears to promise. Confining it needs a real
                  playlist to exist, which is a separate decision.
                  "Save as playlist" is the honest route to it today. */}
              {canSavePlaylists ? (
                <SavePlaylistButton
                  search={search}
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
