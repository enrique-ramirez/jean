import { usePermissions, usePlaylists } from "@/domain/player/usePlayer";
import type { TrackColumns } from "@/shared/api/types";
import { useDragSource } from "@/shared/ui/dnd";
import { FIELD, value } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";

// Dragging tracks out of the list and onto a playlist in the sidebar. The drop
// runs the same useAddTracks the menu does, so both routes copy by index, both
// leave duplicates alone, and both leave an undo behind.
export function useTrackDragSource({
	rows,
	indices,
	source,
	selection,
}: {
	rows: TrackColumns[];
	indices: Refs | null;
	source: LibrarySource;
	selection: Set<number>;
}) {
	const { data: playlists = [] } = usePlaylists();
	const permissions = usePermissions();
	const addTracks = useAddTracks();

	return useDragSource<number[]>({
		disabled: permissions.changePlaylists === false,

		getPayload: (event) => {
			const aimed = targetsFrom(event, rows, selection);
			if (!aimed) return null;
			const { index, positions } = aimed;

			// The row under the pointer, not the lowest-numbered one in the selection
			// -- the ghost should name what you picked up.
			const grabbed = value(rows[index], FIELD.title) ?? "Unknown title";

			return {
				count: positions.length,
				label:
					positions.length === 1
						? grabbed
						: `${grabbed} and ${positions.length - 1} more`,
				items: positions.map((position) =>
					indices ? indices[position] : position,
				),
			};
		},

		// You are already in it, and the library playlist is where the source
		// usually is anyway -- an autoplaylist would refuse the write.
		canDrop: (id) => id !== source.playlistId,

		onDrop: (id, payload) => {
			const target = playlists.find((entry) => entry.id === id);
			if (target) addTracks({ source, target, itemIndices: payload.items });
		},
	});
}
