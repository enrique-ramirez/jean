import { QUEUE_DROP_TARGET } from "@/domain/player/queue";
import { usePermissions, usePlaylists } from "@/domain/player/usePlayer";
import type { TrackColumns } from "@/shared/api/types";
import { useDragSource } from "@/shared/ui/dnd";
import { FIELD, value } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

// The drop runs the same `useAddTracks` and `useQueueTracks` the context menu does, so a drag can do nothing the menu cannot.
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
	const { queueTracks } = useQueueTracks();

	return useDragSource<number[]>({
		disabled: permissions.changePlaylists === false,

		getPayload: (event) => {
			const aimed = targetsFrom(event, rows, selection);
			if (!aimed) return null;
			const { index, positions } = aimed;

			// The row under the pointer, not the lowest-numbered one in the selection: the ghost should name what was picked up.
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

		// The source playlist is excluded because its tracks are already in it; the queue is never the source, so it is never excluded here.
		canDrop: (id) => id !== source.playlistId,

		onDrop: (id, payload) => {
			if (id === QUEUE_DROP_TARGET) {
				queueTracks({ source, itemIndices: payload.items });
				return;
			}

			const target = playlists.find((entry) => entry.id === id);
			if (target) addTracks({ source, target, itemIndices: payload.items });
		},
	});
}
