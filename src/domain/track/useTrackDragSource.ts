import { QUEUE_DROP_TARGET } from "@/domain/player/queue";
import {
	canChangePlaylists,
	usePermissions,
	usePlaylists,
} from "@/domain/player/usePlayer";
import type { TrackColumns } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useDragSource } from "@/shared/ui/dnd";
import { titleOf } from "./fields";
import type { LibrarySource } from "./librarySource";
import { type Refs, refAt } from "./project";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

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
	const t = useTranslate();
	const { queueTracks } = useQueueTracks();

	return useDragSource<number[]>({
		disabled: !canChangePlaylists(permissions),

		getPayload: (event) => {
			const aimed = targetsFrom(event, rows, selection);
			if (!aimed) return null;
			const { index, positions } = aimed;

			const grabbed = titleOf(rows[index], t);

			return {
				count: positions.length,
				label:
					positions.length === 1
						? grabbed
						: t("track.andMore", {
								track: grabbed,
								count: positions.length - 1,
							}),
				items: positions.map((position) => refAt(indices, position)),
			};
		},

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
