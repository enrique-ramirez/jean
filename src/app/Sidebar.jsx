import { ListMusic, Search, Volume2 } from 'lucide-react'

import styles from './Sidebar.module.css'

export function Sidebar({
  playlists,
  selectedId,
  onSelect,
  search,
  isSearchOpen,
  onOpenSearch,
  isOpen,
  isCollapsed,
  onDismiss,
}) {
  return (
    <>
      {isOpen ? <button type="button" className={styles.scrim} aria-label="Close menu" onClick={onDismiss} /> : null}
      <nav
        className={styles.sidebar}
        data-open={isOpen}
        data-collapsed={isCollapsed}
        aria-label="Playlists"
        aria-hidden={isCollapsed}
      >
        {/* Only while a search is live. A permanent entry that means nothing
            most of the time is a dead shelf, and results are not a playlist --
            they do not persist and nothing was written to make them. */}
        {search.hasQuery ? (
          <>
            <p className={styles.heading}>Search</p>
            <button
              type="button"
              className={styles.item}
              aria-current={isSearchOpen}
              onClick={onOpenSearch}
            >
              <Search size={15} strokeWidth={2} aria-hidden="true" />
              <span className={styles.label}>{search.query}</span>
              <span className={styles.count}>{search.matchCount.toLocaleString()}</span>
            </button>
          </>
        ) : null}

        <p className={styles.heading}>Playlists</p>
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            className={styles.item}
            aria-current={playlist.id === selectedId}
            onClick={() => onSelect(playlist.id)}
          >
            {playlist.isCurrent ? (
              <Volume2 size={15} strokeWidth={2} aria-label="Playing from here" />
            ) : (
              <ListMusic size={15} strokeWidth={2} aria-hidden="true" />
            )}
            <span className={styles.label}>{playlist.title}</span>
            <span className={styles.count}>{playlist.itemCount.toLocaleString()}</span>
          </button>
        ))}
      </nav>
    </>
  )
}
