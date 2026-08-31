import { usePermissions, usePlaylists } from '../player/usePlayer.js'
import { useDragSource } from '../ui/dnd.js'
import { FIELD, value } from './fields.js'
import { targetsFrom } from './trackTargets.js'
import { useAddTracks } from './useAddTracks.js'

// Dragging tracks out of the list and onto a playlist in the sidebar. The drop
// runs the same useAddTracks the menu does, so both routes copy by index, both
// leave duplicates alone, and both leave an undo behind.
export function useTrackDragSource({ rows, indices, playlistId, selection }) {
  const { data: playlists = [] } = usePlaylists()
  const permissions = usePermissions()
  const addTracks = useAddTracks()

  return useDragSource({
    disabled: permissions.changePlaylists === false,

    getPayload: (event) => {
      const aimed = targetsFrom(event, rows, selection)
      if (!aimed) return null
      const { index, positions } = aimed

      // The row under the pointer, not the lowest-numbered one in the selection
      // -- the ghost should name what you picked up.
      const grabbed = value(rows[index], FIELD.title) ?? 'Unknown title'

      return {
        count: positions.length,
        label: positions.length === 1 ? grabbed : `${grabbed} and ${positions.length - 1} more`,
        items: positions.map((position) => (indices ? indices[position] : position)),
      }
    },

    // You are already in it, and the library playlist is where the source
    // usually is anyway -- an autoplaylist would refuse the write.
    canDrop: (id) => id !== playlistId,

    onDrop: (id, payload) => {
      const target = playlists.find((entry) => entry.id === id)
      if (target) addTracks({ sourceId: playlistId, target, itemIndices: payload.items })
    },
  })
}
