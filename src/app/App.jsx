import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Moon, PanelLeft, Search, Sun } from 'lucide-react'

import { nextTrack, previousTrack, stop } from '../api/beefweb.js'
import { useIsCompactViewport } from '../hooks/useMediaQuery.js'
import { useStoredState } from '../hooks/useStoredState.js'
import { SCOPE } from '../keyboard/keymap.js'
import { ShortcutSheet } from '../keyboard/ShortcutSheet.jsx'
import { useKeymap } from '../keyboard/useKeymap.js'
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
import { useTheme } from './useTheme.js'
import styles from './App.module.css'

const SEEK_STEP = 5

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

  // Default to whatever the player is on, so opening Jean lands somewhere
  // meaningful rather than on an arbitrary playlist.
  const fallbackId = playlists.find((entry) => entry.isCurrent)?.id ?? playlists[0]?.id
  const selectedId = playlists.some((entry) => entry.id === route) ? route : fallbackId
  const playlist = useMemo(
    () => playlists.find((entry) => entry.id === selectedId) ?? null,
    [playlists, selectedId],
  )

  // A new playlist starts at the top; keeping the old offset would land the
  // user in the middle of something they have not seen.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  const toggleSidebar = () => {
    if (isCompactViewport) setIsSidebarOpen((current) => !current)
    else setIsSidebarCollapsed((current) => !current)
  }

  const openPlaylist = (id) => {
    navigate(`/${id}`)
    setIsSidebarOpen(false)
    setIsPaletteOpen(false)
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
    globalSearch: () => setIsPaletteOpen(true),
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

        <button type="button" className={styles.search} onClick={() => setIsPaletteOpen(true)}>
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <span className={styles.searchLabel}>Go to playlist</span>
          <kbd className={styles.searchHint}>⌘K</kbd>
        </button>

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
          selectedId={selectedId}
          onSelect={openPlaylist}
          isOpen={isSidebarOpen}
          isCollapsed={!isCompactViewport && isSidebarCollapsed}
          onDismiss={() => setIsSidebarOpen(false)}
        />

        <main className={styles.main} ref={scrollRef}>
          <PlaylistView
            playlist={playlist}
            scrollRef={scrollRef}
            isCompactViewport={isCompactViewport}
          />
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
