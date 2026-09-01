import { useMemo, useRef, useState } from 'react'
import { Disc3, GripVertical, Home, ListMusic, Pencil, Plus, Search, Trash2, Undo2, Volume2 } from 'lucide-react'

import { SCOPE } from '../keyboard/keymap.js'
import { useKeymap } from '../keyboard/useKeymap.js'
import {
  untitledPlaylistName,
  usePermissions,
  usePlaylistActions,
} from '../player/usePlayer.js'
import { ActionMenu } from '../ui/ActionMenu.jsx'
import { ALL_MUSIC, withoutJeanPlaylists } from '../library/jeanPlaylists.js'
import { useContextMenu } from '../ui/useContextMenu.js'
import { mergeHandlers } from '../ui/mergeHandlers.js'
import { useDragState } from '../ui/dnd.js'
import { plural } from '../ui/text.js'
import { pushToast } from '../ui/toasts.js'
import { useSortableList } from '../ui/useSortableList.js'
import styles from './Sidebar.module.css'

// Every row in the sidebar is the same shape: an icon that says whether the
// music is coming from here, a name, and sometimes a count. **The accent means
// "this is playing" and nothing else** -- never which row you are looking at,
// which is what aria-current and the row's own styling are for. Tinting by
// selection made the row you were looking at and the row you were listening to
// identical, which is precisely the pair this design exists to separate.
function NavRow({ icon: Icon, label, count, isPlaying, isCurrent, onClick, rowProps, itemProps, children }) {
  return (
    <div className={styles.row} {...rowProps}>
      <button
        type="button"
        className={styles.item}
        aria-current={isCurrent}
        onClick={onClick}
        {...itemProps}
      >
        {isPlaying ? (
          <Volume2 size={15} strokeWidth={2} className={styles.playing} aria-label="Playing from here" />
        ) : (
          <Icon size={15} strokeWidth={2} aria-hidden="true" />
        )}
        <span className={styles.label}>{label}</span>
        {count == null ? null : <span className={styles.count}>{count}</span>}
      </button>
      {children}
    </div>
  )
}

export function Sidebar({
  playlists,
  selectedId,
  onSelect,
  search,
  isSearchOpen,
  onOpenSearch,
  route,
  onOpenRoute,
  playingFrom,
  isOpen,
  isCollapsed,
  onDismiss,
}) {
  const permissions = usePermissions()
  const { create, rename, remove, move } = usePlaylistActions()
  // Only the coarse facts, and only here -- the rows read `isDropTarget` as a
  // plain prop rather than each subscribing to the drag.
  const drag = useDragState()
  // Undefined until the player has answered. Assume yes and let a refusal
  // correct us, rather than showing a read-only sidebar to everybody for the
  // first few hundred milliseconds.
  const canEdit = permissions.changePlaylists !== false

  const menu = useContextMenu({ disabled: !canEdit })
  const [targetId, setTargetId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [focusedId, setFocusedId] = useState(null)

  // Jean's own scratch playlist is not the user's, so it is not in their list.
  // It still exists on the player, and they will see it in foobar -- there is
  // no hidden playlist to be had -- but here it would be a row whose name
  // changed every time they searched.
  const shown = useMemo(() => withoutJeanPlaylists(playlists), [playlists])

  // Which row, if any, the music is coming from -- one answer for every row,
  // from the same place the status bar reads it. Playing search results makes
  // Jean's hidden scratch playlist the current one, so without this the status
  // bar would name a track with nothing on screen accounting for it.
  //
  // Not `some(isScratchPlaylist && isCurrent)`, which was wrong twice over:
  // `isCurrent` goes on pointing at the last playlist played from long after
  // playback stopped, and it never asked what the scratch was *holding*, so a
  // shelf playing lit the search row up whenever a query happened to be typed.
  const playingRoute = playingFrom?.isPlaying ? playingFrom.route : null

  const target = shown.find((entry) => entry.id === targetId) ?? null
  const focusedIndex = shown.findIndex((entry) => entry.id === focusedId)

  // Reordering is the one place the hidden row still has to be accounted for.
  // The player orders the real list and `move` takes a position in it, so a
  // drop position among the visible rows is translated through the playlist
  // that currently occupies it -- which lands the dragged one on the correct
  // side of the hidden entry whichever direction it came from.
  const playerIndexOf = (position) =>
    playlists.findIndex((entry) => entry.id === shown[position].id)

  const reorder = (from, to) =>
    move.mutate(
      { id: shown[from].id, index: playerIndexOf(to) },
      { onError: refused('The player would not reorder that.') },
    )

  const sortable = useSortableList({
    keys: shown.map((entry) => entry.id),
    disabled: !canEdit,
    onReorder: reorder,
  })

  const moveFocused = (delta) => {
    const to = focusedIndex + delta
    if (focusedIndex < 0 || to < 0 || to >= shown.length) return
    reorder(focusedIndex, to)
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

  const refused = (message) => () => pushToast({ tone: 'error', message })

  // Created empty and dropped straight into rename rather than asking for a name
  // first: one click gets you a playlist, and naming it is optional. The view
  // does not change -- a new playlist is somewhere to put things, so throwing
  // you out of the list you were looking at is the wrong reflex.
  const newPlaylist = () =>
    create.mutate(untitledPlaylistName(shown), {
      onSuccess: (playlist) => setRenamingId(playlist.id),
      onError: refused('The player would not create a playlist.'),
    })

  const deletePlaylist = (playlist) => {
    // Step onto the neighbour before it goes, so deleting what you are looking
    // at lands somewhere real instead of on an empty view.
    if (playlist.id === selectedId) {
      const at = shown.findIndex((entry) => entry.id === playlist.id)
      const next = shown[at + 1] ?? shown[at - 1]
      if (next) onSelect(next.id)
    }
    remove.mutate(playlist.id, {
      onError: refused(`${playlist.title} could not be deleted.`),
    })
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
  }, [target, shown, selectedId])

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
        data-drop-scroller=""
        data-receiving={drag.isDragging ? 'true' : undefined}
        aria-label="Playlists"
        aria-hidden={isCollapsed}
      >
        {/* While a search is live, and also while the player is still holding
            one: playing results writes them to a playlist named after the
            query, so the search outlives the tab it was typed in and can be
            picked up on another device. Not a permanent shelf -- with neither
            of those true there is nothing here at all. */}
        {search.hasQuery || search.remembered ? (
          <>
            <p className={styles.heading}>Search</p>
            <NavRow
              icon={Search}
              label={search.query || search.remembered}
              count={search.hasQuery ? search.matchCount.toLocaleString() : ''}
              isPlaying={playingRoute === 'search'}
              isCurrent={isSearchOpen}
              onClick={() => {
                // Taking back a search the player remembered is what loads the
                // library, so it happens on the tap rather than on every launch
                // that happens to follow one.
                if (!search.hasQuery) search.restore()
                onOpenSearch()
              }}
            />
          </>
        ) : null}

        {/* Above the playlists and below the search, which is the order they
            are reached for: search is a thing you are already doing, home is
            where you start, and playlists are what you keep. */}
        <NavRow
          icon={Home}
          label="Home"
          isCurrent={route === '' || route === 'home'}
          onClick={() => onOpenRoute('home')}
        />

        <NavRow
          icon={Disc3}
          label={ALL_MUSIC}
          isPlaying={playingRoute === 'all'}
          isCurrent={route === 'all'}
          onClick={() => onOpenRoute('all')}
        />

        {/* A shelf you played, for as long as it is the thing playing. Jean's
            scratch playlist is hidden, so without this the status bar would name
            a track with nothing on screen accounting for where it came from --
            and unlike a playlist, a shelf has no permanent row to point at. It
            leaves on its own when the next set takes the scratch over. */}
        {playingFrom?.temporaryRow ? (
          <NavRow
            icon={Disc3}
            label={playingFrom.name}
            isPlaying={playingFrom.isPlaying}
            isCurrent={route === playingFrom.route}
            onClick={() => onOpenRoute(playingFrom.route)}
          />
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
        {shown.map((playlist, index) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            isSelected={playlist.id === selectedId}
            isRenaming={playlist.id === renamingId}
            isDropTarget={canEdit && drag.isDragging}
            isDropOver={drag.over === playlist.id}
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
              if (title && title !== playlist.title) {
                rename.mutate(
                  { id: playlist.id, title },
                  { onError: refused(`${playlist.title} could not be renamed.`) },
                )
              }
            }}
          />
        ))}
      </nav>

      <ActionMenu
        isOpen={menu.isOpen && target !== null}
        anchor={menu.anchor}
        header={
          target
            ? {
                icon: ListMusic,
                title: target.title,
                subtitle: plural(target.itemCount, 'track'),
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
  isDropTarget,
  isDropOver,
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
    <NavRow
      icon={ListMusic}
      label={playlist.title}
      count={playlist.itemCount.toLocaleString()}
      // A user's own playlist keeps `isCurrent` rather than reading the scratch:
      // it is a real playlist the player can be inside, so the player's own
      // answer is the honest one. See "Showing playlists".
      isPlaying={playlist.isCurrent}
      isCurrent={isSelected}
      onClick={onSelect}
      itemProps={{ onFocus, onBlur }}
      rowProps={{
        ref,
        style: { ...pressableStyle, ...dragStyle },
        'data-drop-target': isDropTarget ? playlist.id : undefined,
        'data-drop-over': isDropOver ? 'true' : undefined,
        ...rowState,
        // Merged, not spread one over the other: the long press and the drag
        // both want onPointerDown, Move, Up and Cancel, and the second object
        // would quietly win all four. They sort themselves out by pointer type.
        ...mergeHandlers(gestures, dragProps),
      }}
    >
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
    </NavRow>
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
