import { ListMusic, Volume2 } from 'lucide-react'

import styles from './Sidebar.module.css'

export function Sidebar({ playlists, selectedId, onSelect, isOpen, isCollapsed, onDismiss }) {
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
