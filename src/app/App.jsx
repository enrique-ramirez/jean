import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Moon, PanelLeft, Sun } from 'lucide-react'

import { nextTrack, previousTrack, stop } from '../api/beefweb.js'
import { useIsCompactViewport } from '../hooks/useMediaQuery.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { SCOPE } from '../keyboard/keymap.js'
import { ShortcutSheet } from '../keyboard/ShortcutSheet.jsx'
import { useKeymap } from '../keyboard/useKeymap.js'
import { LibrarySearchField } from '../library/LibrarySearchField.jsx'
import { SearchResults } from '../library/SearchResults.jsx'
import { useLibrarySearch } from '../library/useLibrarySearch.js'
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
import { CommandPalette } from './CommandPalette.jsx'
import { Sidebar } from './Sidebar.jsx'
import { useHashRoute } from './useHashRoute.js'
import { useScrollMemory } from './useScrollMemory.js'
import { useTheme } from './useTheme.js'
import styles from './App.module.css'

const SEEK_STEP = 5
const SEARCH_ROUTE = 'search'

export function App() {
  usePlayerStream()

  const { data: playlists = [] } = usePlaylists()
  const { data: playerSnapshot } = usePlayer()
  const playPause = usePlayPause()
  const seekBy = useSeekBy()
  const volume = useVolume()
  const { theme, toggle: toggleTheme } = useTheme()
  const isCompactViewport = useIsCompactViewport()
  const search = useLibrarySearch(playlists)

  const [route, navigate] = useHashRoute()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useStoredState('jean.sidebarCollapsed', false)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const scrollRef = useRef(null)

  const isSearchRoute = route === SEARCH_ROUTE
  const routedId = playlists.some((entry) => entry.id === route) ? route : null

  // Where leaving the search puts you back. Held rather than derived: while the
  // results are on screen the route no longer names a playlist.
  const lastPlaylistId = useRef(null)
  useEffect(() => {
    if (routedId) lastPlaylistId.current = routedId
  }, [routedId])

  // Default to whatever the player is on, so opening Jean lands somewhere
  // meaningful rather than on an arbitrary playlist.
  const fallbackId = playlists.find((entry) => entry.isCurrent)?.id ?? playlists[0]?.id
  // Checked against the live list rather than trusted: a playlist you were last
  // looking at can be deleted, from here or from the desktop.
  const remembered = playlists.some((entry) => entry.id === lastPlaylistId.current)
    ? lastPlaylistId.current
    : null
  const selectedId = routedId ?? remembered ?? fallbackId
  const playlist = useMemo(
    () => playlists.find((entry) => entry.id === selectedId) ?? null,
    [playlists, selectedId],
  )

  // Each result set is its own view, so refining a query starts at the top
  // while stepping back into a playlist returns to the row you left.
  useScrollMemory(scrollRef, isSearchRoute ? search.viewKey : `playlist:${selectedId}`)

  const toggleSidebar = () => {
    if (isCompactViewport) setIsSidebarOpen((current) => !current)
    else setIsSidebarCollapsed((current) => !current)
  }

  const openPlaylist = (id) => {
    navigate(`/${id}`)
    setIsSidebarOpen(false)
    setIsPaletteOpen(false)
  }

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

        <LibrarySearchField search={search} onChange={onQueryChange} onDismiss={dismissSearch} />

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
          selectedId={isSearchRoute ? null : selectedId}
          onSelect={openPlaylist}
          search={search}
          isSearchOpen={isSearchRoute}
          onOpenSearch={openSearch}
          isOpen={isSidebarOpen}
          isCollapsed={!isCompactViewport && isSidebarCollapsed}
          onDismiss={() => setIsSidebarOpen(false)}
        />

        <main className={styles.main} ref={scrollRef}>
          {isSearchRoute ? (
            <SearchResults
              search={search}
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

      <StatusBar />

      {isPaletteOpen ? (
        <CommandPalette
          playlists={playlists}
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
