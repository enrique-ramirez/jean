import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Moon, PanelLeft, Sun } from 'lucide-react'

import { nextTrack, previousTrack, stop } from '../api/beefweb.js'
import { useIsCompactViewport } from '../hooks/useMediaQuery.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { SCOPE } from '../keyboard/keymap.js'
import { ShortcutSheet } from '../keyboard/ShortcutSheet.jsx'
import { useKeymap } from '../keyboard/useKeymap.js'
import { HomeView } from '../home/HomeView.jsx'
import { SHELVES, buildShelves, refsOfShelf } from '../home/shelves.js'
import { albumsOf } from '../home/albums.js'
import { LibraryListView } from '../library/LibraryListView.jsx'
import { LibrarySearchField } from '../library/LibrarySearchField.jsx'
import { SearchResults } from '../library/SearchResults.jsx'
import { ALL_MUSIC, SCRATCH_KIND } from '../library/jeanPlaylists.js'
import { project, wholeLibrary } from '../library/project.js'
import { useLibrary } from '../library/useLibrary.js'
import { useLibrarySearch } from '../library/useLibrarySearch.js'
import { useHomePlayback } from '../home/useHomePlayback.js'
import { usePlayingFrom } from '../library/usePlayingFrom.js'
import { StatusBar } from '../player/StatusBar.jsx'
import {
  usePlayPause,
  usePlayer,
  usePlayerStream,
  usePlaylists,
  useSeekBy,
  useVolume,
} from '../player/usePlayer.js'
import { PlaylistView } from '../playlist/PlaylistView.jsx'
import { Button } from '../ui/Button.jsx'
import { DragGhost } from '../ui/DragGhost.jsx'
import { Toasts } from '../ui/Toasts.jsx'
import { withoutJeanPlaylists } from '../library/jeanPlaylists.js'
import { CommandPalette } from './CommandPalette.jsx'
import { Sidebar } from './Sidebar.jsx'
import { useHashRoute } from './useHashRoute.js'
import { useScrollMemory } from './useScrollMemory.js'
import { useTheme } from './useTheme.js'
import styles from './App.module.css'

const SEEK_STEP = 5
const SEARCH_ROUTE = 'search'
const HOME_ROUTE = 'home'
const ALL_ROUTE = 'all'
const SHELF_PREFIX = 'shelf/'
const EMPTY_VIEW = { rows: [], indices: new Int32Array(0), heat: new Float32Array(0), patina: new Float32Array(0), playedCount: 0 }

export function App() {
  usePlayerStream()

  const { data: playlists = [] } = usePlaylists()
  const { data: playerSnapshot } = usePlayer()
  const playPause = usePlayPause()
  const seekBy = useSeekBy()
  const volume = useVolume()
  const { theme, toggle: toggleTheme } = useTheme()
  const isCompactViewport = useIsCompactViewport()
  const [route, navigate] = useHashRoute()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useStoredState('jean.sidebarCollapsed', false)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const scrollRef = useRef(null)

  const isSearchRoute = route === SEARCH_ROUTE
  const isAllRoute = route === ALL_ROUTE
  const shelfId = route.startsWith(SHELF_PREFIX) ? route.slice(SHELF_PREFIX.length) : null
  const shelf = shelfId ? SHELVES.find((entry) => entry.id === shelfId) : null
  // Home is where `/` lands, so an unrecognised hash falls here rather than
  // onto whichever playlist happened to be first.
  const isHomeRoute = route === '' || route === HOME_ROUTE

  // The library is loaded for the views that show it. Search asks for it
  // separately, on focus, because reaching for the field is the ask and the
  // route cannot know.
  const library = useLibrary(playlists, {
    wanted: isHomeRoute || isAllRoute || Boolean(shelf),
  })
  const search = useLibrarySearch(library, playlists)
  const home = useHomePlayback({ library, playlists, navigate })

  // The scratch carries a name; the route it belongs to is Jean's to work out,
  // and so is whether the sidebar already draws a row for it. All music and the
  // search have permanent entries and are marked in place. A shelf has none --
  // it is the one set that needs a row conjured for as long as it is playing.
  const playing = usePlayingFrom()
  const playingFrom = useMemo(() => {
    if (!playing) return null
    if (playing.kind === SCRATCH_KIND.all) return { ...playing, route: ALL_ROUTE }
    if (playing.kind === SCRATCH_KIND.search) return { ...playing, route: SEARCH_ROUTE }
    if (playing.kind !== SCRATCH_KIND.shelf) return null

    const entry = SHELVES.find((item) => item.title === playing.label)
    return entry ? { ...playing, route: `${SHELF_PREFIX}${entry.id}`, temporaryRow: true } : null
  }, [playing])

  // All music is the library itself, unprojected -- copying 30,000 rows to
  // produce a copy of themselves is the one filter that can afford to do
  // nothing. A shelf is its albums' refs, in shelf order.
  const allMusic = useMemo(() => wholeLibrary(library), [library])
  const shelfView = useMemo(() => {
    if (!shelf || library.rows.length === 0) return null
    const albums = albumsOf(library)
    const built = buildShelves(albums).find((entry) => entry.id === shelf.id)
    return built ? project(library, refsOfShelf(built)) : null
  }, [shelf, library])

  // Jean's own scratch playlist is not somewhere to browse to. Playing a set of
  // search results makes it the current playlist, and landing there would show
  // those results stripped of the search that made them, under a name nobody
  // chose.
  const browsable = useMemo(() => withoutJeanPlaylists(playlists), [playlists])
  const routedId = browsable.some((entry) => entry.id === route) ? route : null
  const isLibraryRoute = isHomeRoute || isAllRoute || Boolean(shelf) || isSearchRoute

  // A reload lands back on #/search with an empty field, and the results gone
  // with it -- the query was only ever in memory. The player still knows what
  // it was, because the playlist it is holding is named after it, so take it
  // back. Once per mount: clearing the search navigates away, but not before a
  // render where both conditions still hold.
  const restoredSearch = useRef(false)
  const { hasQuery, remembered: rememberedQuery, restore: restoreSearch } = search
  useEffect(() => {
    if (restoredSearch.current || !isSearchRoute || hasQuery || !rememberedQuery) return
    restoredSearch.current = true
    restoreSearch()
  }, [isSearchRoute, hasQuery, rememberedQuery, restoreSearch])

  // Where leaving the search puts you back. Held rather than derived: while the
  // results are on screen the route no longer names a playlist.
  const lastPlaylistId = useRef(null)
  useEffect(() => {
    if (routedId) lastPlaylistId.current = routedId
  }, [routedId])

  // Default to whatever the player is on, so opening Jean lands somewhere
  // meaningful rather than on an arbitrary playlist.
  const fallbackId = browsable.find((entry) => entry.isCurrent)?.id ?? browsable[0]?.id
  // Checked against the live list rather than trusted: a playlist you were last
  // looking at can be deleted, from here or from the desktop.
  const remembered = browsable.some((entry) => entry.id === lastPlaylistId.current)
    ? lastPlaylistId.current
    : null
  const selectedId = routedId ?? remembered ?? fallbackId
  const playlist = useMemo(
    () => browsable.find((entry) => entry.id === selectedId) ?? null,
    [browsable, selectedId],
  )

  // Each result set is its own view, so refining a query starts at the top
  // while stepping back into a playlist returns to the row you left.
  useScrollMemory(
    scrollRef,
    isSearchRoute ? search.viewKey : isLibraryRoute ? `library:${route}` : `playlist:${selectedId}`,
  )

  const toggleSidebar = () => {
    if (isCompactViewport) setIsSidebarOpen((current) => !current)
    else setIsSidebarCollapsed((current) => !current)
  }

  const openPlaylist = (id) => {
    navigate(`/${id}`)
    setIsSidebarOpen(false)
    setIsPaletteOpen(false)
  }

  const openRoute = useCallback(
    (next) => {
      navigate(`/${next}`)
      setIsSidebarOpen(false)
    },
    [navigate],
  )

  const openSearch = useCallback(() => {
    navigate(`/${SEARCH_ROUTE}`)
    setIsSidebarOpen(false)
  }, [navigate])

  const onQueryChange = (value) => {
    search.setQuery(value)
    // Typing is the navigation. Waiting for Enter would leave the first
    // keystrokes filtering a page nobody is looking at.
    if (value.trim()) openSearch()
  }

  const dismissSearch = () => {
    search.clear()
    if (isSearchRoute) navigate(`/${selectedId}`)
  }

  useKeymap(SCOPE.global, {
    playPause: () => playPause.mutate(),
    nextTrack: () => nextTrack(),
    previousTrack: () => previousTrack(),
    stop: () => stop(),
    seekBack: () => seekBy.mutate(-SEEK_STEP),
    seekForward: () => seekBy.mutate(SEEK_STEP),
    volumeUp: () => volume.up(),
    volumeDown: () => volume.down(),
    toggleMute: () => volume.setMuted(!volume.volume?.isMuted),
    globalSearch: () => {
      search.focus()
      if (search.hasQuery) openSearch()
    },
    openPalette: () => setIsPaletteOpen(true),
    toggleSidebar,
    showShortcuts: () => setIsSheetOpen((current) => !current),
    toggleTheme,
  })

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <Button
          variant="ghost"
          icon={PanelLeft}
          aria-label={isSidebarCollapsed || !isSidebarOpen ? 'Show playlists' : 'Hide playlists'}
          aria-expanded={isCompactViewport ? isSidebarOpen : !isSidebarCollapsed}
          onClick={toggleSidebar}
        />

        {isCompactViewport ? null : (
          <p className={styles.brand}>
            je<span>a</span>n
          </p>
        )}

        <LibrarySearchField
          search={search}
          library={library}
          onChange={onQueryChange}
          onDismiss={dismissSearch}
        />

        <div className={styles.actions}>
          <Button
            variant="ghost"
            icon={Keyboard}
            aria-label="Keyboard shortcuts"
            onClick={() => setIsSheetOpen(true)}
          />
          <Button
            variant="ghost"
            icon={theme === 'dark' ? Sun : Moon}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          />
        </div>
      </header>

      <div className={styles.body} data-collapsed={!isCompactViewport && isSidebarCollapsed}>
        <Sidebar
          playlists={playlists}
          selectedId={
            // Only a playlist route selects a playlist. `selectedId` falls back
            // to the remembered or current one so that leaving the search has
            // somewhere to return to -- but passing that through here lit a
            // playlist row while you were on Home, beside the Home row that was
            // also lit. Two rows cannot both be where you are.
            isLibraryRoute ? null : selectedId
          }
          onSelect={openPlaylist}
          search={search}
          isSearchOpen={isSearchRoute}
          onOpenSearch={openSearch}
          route={route}
          onOpenRoute={openRoute}
          playingFrom={playingFrom}
          isOpen={isSidebarOpen}
          isCollapsed={!isCompactViewport && isSidebarCollapsed}
          onDismiss={() => setIsSidebarOpen(false)}
        />

        <main className={styles.main} ref={scrollRef}>
          {isHomeRoute ? (
            <HomeView
              library={library}
              playlists={playlists}
              onPlayAlbum={home.playShelf}
              // The whole library, which App already holds for the All music
              // route -- the front door plays exactly the set that route shows,
              // so it must be exactly the same refs.
              onPlayEverything={() => home.playEverything(allMusic.indices)}
              onShuffleEverything={() => home.shuffleEverything(allMusic.indices)}
              canPlay={home.canPlay}
              canShuffle={home.canShuffle}
            />
          ) : isAllRoute || shelf ? (
            <LibraryListView
              library={library}
              view={(shelf ? shelfView : allMusic) ?? EMPTY_VIEW}
              kind={shelf ? SCRATCH_KIND.shelf : SCRATCH_KIND.all}
              label={shelf ? shelf.title : ''}
              eyebrow={shelf ? 'Shelf' : 'Your library'}
              title={shelf ? shelf.title : ALL_MUSIC}
              playlists={playlists}
              scrollRef={scrollRef}
              isCompactViewport={isCompactViewport}
              emptyNotice={
                library.isLoading ? 'Reading your library...' : 'Nothing in your library yet.'
              }
            />
          ) : isSearchRoute ? (
            <SearchResults
              search={search}
              library={library}
              playlists={playlists}
              scrollRef={scrollRef}
              isCompactViewport={isCompactViewport}
              onOpenPlaylist={openPlaylist}
            />
          ) : (
            <PlaylistView
              playlist={playlist}
              scrollRef={scrollRef}
              isCompactViewport={isCompactViewport}
            />
          )}
        </main>
      </div>

      {/* A sibling of the body, not a child of it -- it shares the body's cell
          in the app grid, which is what puts it above the status bar without
          anyone having to know how tall the status bar is. */}
      <Toasts />

      <StatusBar />

      <DragGhost />

      {isPaletteOpen ? (
        <CommandPalette
          playlists={browsable}
          onSelect={openPlaylist}
          onDismiss={() => setIsPaletteOpen(false)}
        />
      ) : null}

      {isSheetOpen ? <ShortcutSheet onDismiss={() => setIsSheetOpen(false)} /> : null}

      <span className="visually-hidden" aria-live="polite">
        {playerSnapshot?.player?.playbackState === 'playing' ? 'Playing' : 'Paused'}
      </span>
    </div>
  )
}
