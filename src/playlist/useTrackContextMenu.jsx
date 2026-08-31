import { useMemo, useState } from 'react'
import { ListMusic, ListPlus, Music } from 'lucide-react'

import { withoutScratchPlaylists } from '../library/scratchPlaylist.js'
import { usePermissions, usePlaylists } from '../player/usePlayer.js'
import { ActionMenu } from '../ui/ActionMenu.jsx'
import { useContextMenu } from '../ui/useContextMenu.js'
import { FIELD, value } from './fields.js'
import { targetsFrom } from './trackTargets.js'
import { useAddTracks } from './useAddTracks.js'

const sameList = (a, b) => a.length === b.length && a.every((entry, at) => entry === b[at])

// One menu for a list of any length. The gestures go on the container, not on
// the rows: 30,000 rows must not each carry a handler, and the virtualiser
// unmounts them under the pointer anyway. Which row was hit is read back out of
// the DOM at the moment it is asked for.
//
// Returns the JSX as well as the props, the way usePanel does inside ActionMenu
// -- the alternative is lifting two pieces of state into a component that is
// already holding fifteen.
export function useTrackContextMenu({ rows, indices, playlistId, selection, onSelectOnly }) {
  const { data: playlists = [] } = usePlaylists()
  const permissions = usePermissions()
  const addTracks = useAddTracks()
  const menu = useContextMenu()

  // View positions, not playlist indices. The translation happens once, where
  // the request is built.
  const [positions, setPositions] = useState([])

  const canEdit = permissions.changePlaylists !== false

  // Right-clicking inside a selection acts on all of it; right-clicking outside
  // one replaces it -- the rule every file manager uses, and the reason TrackRow
  // ignores non-primary buttons, since selecting on pointer-down would collapse
  // the selection before the menu that is about to act on it ever opened.
  //
  // `adopt` is off for the hold, and that is not a shortcut. Claiming the
  // selection on pointer-down would undo the shift-click that just happened in
  // the same event, and on touch there is nothing to adopt anyway: there are no
  // modifier keys, so TrackRow has already made the pressed row the selection.
  const aim = (event, { adopt }) => {
    const aimed = targetsFrom(event, rows, selection)
    if (!aimed) return false

    const chosen = adopt ? aimed.positions : [aimed.index]
    if (adopt && !selection.has(aimed.index)) onSelectOnly(aimed.index)

    setPositions((current) => (sameList(current, chosen) ? current : chosen))
    return true
  }

  const triggerProps = {
    ...menu.triggerProps,
    onContextMenu: (event) => {
      if (!aim(event, { adopt: true })) return
      menu.triggerProps.onContextMenu(event)
    },
    onPointerDown: (event) => {
      // Only touch arms a hold, so a mouse does no work here at all -- this
      // fires on every click in a thirty-thousand row list.
      if (event.pointerType === 'mouse') return
      // Resolved now rather than when the hold fires: by then the pointer has
      // been down for four hundred milliseconds and the event is long gone.
      if (aim(event, { adopt: false })) menu.triggerProps.onPointerDown(event)
    },
  }

  const count = positions.length

  const actions = useMemo(() => {
    if (count === 0) return []

    const itemIndices = positions.map((position) => (indices ? indices[position] : position))
    // Not the one you are already in, and not Jean's own scratch playlist --
    // that is a place results are put to be played, not a playlist anyone
    // should be able to file tracks into. It would be emptied by the next
    // search anyway.
    const targets = withoutScratchPlaylists(playlists).filter((entry) => entry.id !== playlistId)

    return [
      {
        id: 'add',
        label: 'Add to playlist',
        icon: ListPlus,
        disabled: !canEdit || targets.length === 0,
        filter: 'Find a playlist',
        items: targets.map((target) => ({
          id: target.id,
          label: target.title,
          icon: ListMusic,
          onSelect: () => addTracks({ sourceId: playlistId, target, itemIndices }),
        })),
      },
    ]
  }, [count, positions, indices, playlists, playlistId, canEdit, addTracks])

  const header = useMemo(() => {
    if (count === 0) return null
    if (count > 1) {
      return { icon: ListMusic, title: `${count.toLocaleString()} tracks`, subtitle: 'Selected' }
    }

    const row = rows[positions[0]]
    return {
      icon: Music,
      title: value(row, FIELD.title) ?? 'Unknown title',
      subtitle: value(row, FIELD.artist) ?? 'Unknown artist',
    }
  }, [count, positions, rows])

  const element = (
    <ActionMenu
      isOpen={menu.isOpen && count > 0}
      anchor={menu.anchor}
      header={header}
      actions={actions}
      onDismiss={menu.close}
    />
  )

  return { triggerProps, element }
}
