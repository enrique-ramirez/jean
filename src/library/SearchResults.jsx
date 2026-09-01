import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import { useIsPlaying, usePermissions } from '../player/usePlayer.js'
import { Mosaic } from '../playlist/Mosaic.jsx'
import { PlayActions } from '../playlist/PlayActions.jsx'
import { TrackBrowser } from '../playlist/TrackBrowser.jsx'
import { ViewHeader } from '../playlist/ViewHeader.jsx'
import { summarise } from '../playlist/stats.js'
import { useAvailableFields } from '../playlist/useAvailableFields.js'
import { Button } from '../ui/Button.jsx'
import { plural } from '../ui/text.js'
import { LibrarySetup } from './LibrarySetup.jsx'
import { SavePlaylistButton } from './SavePlaylistButton.jsx'
import { SCRATCH_KIND } from './jeanPlaylists.js'
import { useActivePosition } from './useActivePosition.js'
import { usePlaySet } from './usePlaySet.js'
import styles from './SearchResults.module.css'

// A view over the library, never a playlist. Typing and refining write nothing:
// the player only hears about a result set once somebody asks to hear it, and
// then it is materialised into the scratch so playback stays inside the
// matches. See jeanPlaylists.js for why that is not optional.
export function SearchResults({ search, library, playlists, scrollRef, isCompactViewport, onOpenPlaylist }) {
  const browserRef = useRef(null)
  const [isSaving, setIsSaving] = useState(false)

  const isPlaying = useIsPlaying()
  // A read-only instance gets a read-only Jean: no button that would 403, and
  // no Shuffle, which without a scratch playlist would shuffle the whole
  // library rather than these results.
  const canSavePlaylists = usePermissions().changePlaylists === true

  const { rows, indices, heat, patina, playedCount } = search.results
  const { hasPlayCounts } = useAvailableFields(rows)
  const stats = useMemo(() => summarise(rows, playedCount), [rows, playedCount])

  const { play, scratch } = usePlaySet({ library, playlists })
  const holdsThisView = scratch.holdsView(SCRATCH_KIND.search, search.query, indices.length)

  const activeIndex = useActivePosition({
    source: library.source,
    indices,
    scratch,
    holdsThisView,
  })

  useKeymap(
    SCOPE.search,
    { saveSearch: () => setIsSaving(true) },
    { enabled: canSavePlaylists && rows.length > 0 && !library.isLoading },
  )

  if (library.needsSetup) return <LibrarySetup playlists={playlists} />

  if (library.error) {
    return <p className={styles.notice}>Could not read your library -- {library.error.message}</p>
  }

  if (!search.hasQuery) {
    return (
      <div className={styles.idle}>
        <Search size={26} strokeWidth={1.5} aria-hidden="true" />
        <h1 className={styles.idleTitle}>Search your library</h1>
        <p className={styles.idleBody}>
          {/* "Your library", never the name of whatever is standing in for it.
              Which source answered is Jean's business, and with a media library
              API there is no playlist to name at all. */}
          {library.count.toLocaleString()} tracks in your library. Title, artist and album, as you
          type -- every word has to match, in any order.
        </p>
        <Button variant="primary" icon={Search} onClick={search.focus}>
          Start typing
        </Button>
      </div>
    )
  }

  return (
    <TrackBrowser
      ref={browserRef}
      rows={rows}
      indices={indices}
      source={library.source}
      viewKey={search.viewKey}
      heat={heat}
      patina={patina}
      activeIndex={activeIndex}
      isPlaying={isPlaying}
      isLoading={library.isLoading}
      loaded={library.loaded}
      total={library.total}
      scrollRef={scrollRef}
      isCompactViewport={isCompactViewport}
      keysEnabled={!search.isFocused}
      onPlay={(position) =>
        play({ kind: SCRATCH_KIND.search, label: search.query, refs: indices, position })
      }
      // The library search is this list's filter, so `/` belongs to the field
      // rather than to a second finder nested inside the results.
      onOpenFinder={search.focus}
      emptyNotice="Nothing in your library matches that."
      header={
        <ViewHeader
          eyebrow="Search results in your library"
          title={search.query}
          stats={stats}
          hasPlayCounts={hasPlayCounts}
          aside={
            <Mosaic
              source={library.source}
              trackCount={rows.length}
              indices={indices}
              seed={search.viewKey}
            />
          }
          actions={
            <PlayActions
              browserRef={browserRef}
              trackCount={rows.length}
              canShuffle={canSavePlaylists}
            >
              {canSavePlaylists ? (
                <SavePlaylistButton
                  search={search}
                  library={library}
                  scratch={scratch}
                  holdsResults={holdsThisView}
                  isOpen={isSaving}
                  onOpenChange={setIsSaving}
                  onOpenPlaylist={onOpenPlaylist}
                />
              ) : null}
            </PlayActions>
          }
        />
      }
      toolbarLeading={
        <p className={styles.summary}>
          {library.isLoading
            ? `Searching ${library.loaded.toLocaleString()} of ${library.total.toLocaleString()}...`
            : plural(search.matchCount, 'match', 'matches')}
        </p>
      }
    />
  )
}
