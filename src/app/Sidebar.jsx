import { useMemo, useRef, useState } from 'react'
import {
  GripVertical,
  ListMusic,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  X,
} from 'lucide-react'

import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import {
  untitledPlaylistName,
  usePermissions,
  usePlaylistActions,
} from '../player/usePlayer.js'
import { ActionMenu } from '../ui/ActionMenu.jsx'
import { useContextMenu } from '../ui/useContextMenu.js'
import { mergeHandlers } from '../ui/mergeHandlers.js'
import { useSortableList } from '../ui/useSortableList.js'
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
  const permissions = usePermissions()
  const { create, rename, remove, move } = usePlaylistActions()
  // Undefined until the player has answered. Assume yes and let a refusal
  // correct us, rather than showing a read-only sidebar to everybody for the
  // first few hundred milliseconds.
  const canEdit = permissions.changePlaylists !== false

  const menu = useContextMenu({ disabled: !canEdit })
  const [targetId, setTargetId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [focusedId, setFocusedId] = useState(null)

  const target = playlists.find((entry) => entry.id === targetId) ?? null
  const focusedIndex = playlists.findIndex((entry) => entry.id === focusedId)

  const sortable = useSortableList({
    keys: playlists.map((entry) => entry.id),
    disabled: !canEdit,
    onReorder: (from, to) => move.mutate({ id: playlists[from].id, index: to }),
  })

  const moveFocused = (delta) => {
    const to = focusedIndex + delta
    if (focusedIndex < 0 || to < 0 || to >= playlists.length) return
    move.mutate({ id: playlists[focusedIndex].id, index: to })
  }

  // Only while a playlist row holds focus. These are ordinary arrow keys with a
  // modifier, and they must not fire while the cursor is in the track list.
  useKeymap(
    SCOPE.sidebar,
    {
      movePlaylistUp: () => moveFocused(-1),
      movePlaylistDown: () => moveFocused(1),
    },
    { enabled: canEdit && focusedIndex >= 0 },
  )

  // Created empty and dropped straight into rename, rather than asking for a
  // name first: one click gets you a playlist, and naming it is optional. The
  // view does not change -- a new playlist is somewhere to put things, so
  // throwing you out of the list you were looking at is the wrong reflex.
  const newPlaylist = () =>
    create.mutate(untitledPlaylistName(playlists), {
      onSuccess: (playlist) => setRenamingId(playlist.id),
    })

  const deletePlaylist = (playlist) => {
    // Step onto the neighbour before it goes, so deleting what you are looking
    // at lands somewhere real instead of on an empty view.
    if (playlist.id === selectedId) {
      const at = playlists.findIndex((entry) => entry.id === playlist.id)
      const next = playlists[at + 1] ?? playlists[at - 1]
      if (next) onSelect(next.id)
    }
    remove.mutate(playlist.id)
  }

  const actions = useMemo(() => {
    if (!target) return []

    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: Pencil,
        onSelect: () => setRenamingId(target.id),
      },
      { type: 'separator' },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        items: [
          {
            type: 'message',
            text: `${target.title} will be removed from the player. Its ${target.itemCount.toLocaleString()} tracks stay where they are on disk.`,
          },
          {
            id: 'confirm',
            label: 'Delete playlist',
            icon: Trash2,
            danger: true,
            onSelect: () => deletePlaylist(target),
          },
          { id: 'cancel', label: 'Keep it', icon: Undo2 },
        ],
      },
    ]
  }, [target, playlists, selectedId])

  const failure = create.error ?? move.error ?? rename.error ?? remove.error
  const clearFailure = () => {
    create.reset()
    move.reset()
    rename.reset()
    remove.reset()
  }

  return (
    <>
      {isOpen ? (
        <button type="button" className={styles.scrim} aria-label="Close menu" onClick={onDismiss} />
      ) : null}
      <nav
        className={styles.sidebar}
        ref={sortable.scrollRef}
        data-open={isOpen}
        data-collapsed={isCollapsed}
        data-reordering={sortable.isDragging ? 'true' : undefined}
        aria-label="Playlists"
        aria-hidden={isCollapsed}
      >
        {/* Only while a search is live. A permanent entry that means nothing
            most of the time is a dead shelf, and results are not a playlist --
            they do not persist and nothing was written to make them. */}
        {search.hasQuery ? (
          <>
            <p className={styles.heading}>Search</p>
            <div className={styles.row}>
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
            </div>
          </>
        ) : null}

        <div className={styles.sectionHeader}>
          <p className={styles.heading}>Playlists</p>
          {canEdit ? (
            <button
              type="button"
              className={styles.add}
              aria-label="New playlist"
              disabled={create.isPending}
              onClick={newPlaylist}
            >
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {playlists.map((playlist, index) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            isSelected={playlist.id === selectedId}
            isRenaming={playlist.id === renamingId}
            canEdit={canEdit}
            rowProps={sortable.itemProps(index)}
            dragProps={sortable.dragProps(index)}
            handleProps={sortable.handleProps(index)}
            menuProps={{
              ...menu.triggerProps,
              onPointerDown: (event) => {
                setTargetId(playlist.id)
                menu.triggerProps.onPointerDown(event)
              },
              onContextMenu: (event) => {
                setTargetId(playlist.id)
                menu.triggerProps.onContextMenu(event)
              },
            }}
            onSelect={() => onSelect(playlist.id)}
            onFocus={() => setFocusedId(playlist.id)}
            onBlur={() => setFocusedId((current) => (current === playlist.id ? null : current))}
            onRename={(title) => {
              setRenamingId(null)
              if (title && title !== playlist.title) rename.mutate({ id: playlist.id, title })
            }}
          />
        ))}

        {/* The player refusing an edit is a real outcome, not a bug -- smart
            playlists reject every one of these and say nothing about it in
            their metadata. Say what happened rather than silently reverting. */}
        {failure ? (
          <button
            type="button"
            className={styles.notice}
            title={failure.message}
            onClick={clearFailure}
          >
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            The player would not do that
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </nav>

      <ActionMenu
        isOpen={menu.isOpen && target !== null}
        anchor={menu.anchor}
        header={
          target
            ? {
                icon: ListMusic,
                title: target.title,
                subtitle: `${target.itemCount.toLocaleString()} ${target.itemCount === 1 ? 'track' : 'tracks'}`,
              }
            : null
        }
        actions={actions}
        onDismiss={menu.close}
      />
    </>
  )
}

function PlaylistRow({
  playlist,
  isSelected,
  isRenaming,
  canEdit,
  rowProps,
  dragProps,
  handleProps,
  menuProps,
  onSelect,
  onFocus,
  onBlur,
  onRename,
}) {
  const { style: pressableStyle, ...gestures } = menuProps
  const { style: dragStyle, ref, ...rowState } = rowProps

  if (isRenaming) {
    return (
      <div className={styles.row} ref={ref} style={dragStyle} {...rowState}>
        <RenameField title={playlist.title} onCommit={onRename} />
      </div>
    )
  }

  return (
    // Merged, not spread one over the other: the long press and the drag both
    // want onPointerDown, Move, Up and Cancel, and the second object would
    // quietly win all four. They sort themselves out by pointer type -- the
    // hold ignores a mouse, the row drag ignores everything that is not one.
    <div
      className={styles.row}
      ref={ref}
      style={{ ...pressableStyle, ...dragStyle }}
      {...rowState}
      {...mergeHandlers(gestures, dragProps)}
    >
      <button
        type="button"
        className={styles.item}
        aria-current={isSelected}
        onClick={onSelect}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {playlist.isCurrent ? (
          <Volume2 size={15} strokeWidth={2} aria-label="Playing from here" />
        ) : (
          <ListMusic size={15} strokeWidth={2} aria-hidden="true" />
        )}
        <span className={styles.label}>{playlist.title}</span>
        <span className={styles.count}>{playlist.itemCount.toLocaleString()}</span>
      </button>

      {/* Not focusable: reordering by keyboard is Alt with the arrows, on the
          row itself, which needs no separate stop on the tab route. */}
      {canEdit ? (
        <span
          className={styles.grip}
          aria-hidden="true"
          onPointerDown={(event) => {
            // The row is waiting to see whether this becomes a long press. On
            // the grip it never should -- holding the handle is the start of a
            // drag, and both gestures firing at once opens a menu mid-drag.
            // Stopping here also keeps the row's own mouse drag from starting a
            // second time; the move and release still bubble to it.
            event.stopPropagation()
            handleProps.onPointerDown?.(event)
          }}
        >
          <GripVertical size={15} strokeWidth={2} />
        </span>
      ) : null}
    </div>
  )
}

function RenameField({ title, onCommit }) {
  const [value, setValue] = useState(title)
  // Escape has to beat the blur that follows it, or cancelling would commit.
  const cancelled = useRef(false)

  return (
    <form
      className={styles.renameForm}
      onSubmit={(event) => {
        event.preventDefault()
        onCommit(value.trim())
      }}
    >
      <input
        className={styles.renameInput}
        value={value}
        aria-label={`Rename ${title}`}
        spellCheck="false"
        autoComplete="off"
        autoFocus
        onFocus={(event) => event.target.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => (cancelled.current ? onCommit(null) : onCommit(value.trim()))}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          cancelled.current = true
          event.stopPropagation()
          event.currentTarget.blur()
        }}
      />
    </form>
  )
}
