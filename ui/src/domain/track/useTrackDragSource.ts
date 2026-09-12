import { QUEUE_DROP_TARGET, queueDropIndex } from "@/domain/player/queue";
import {
	canChangePlaylists,
	usePermissions,
	usePlaylists,
} from "@/domain/player/usePlayer";
import type { Permissions } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useDragSource } from "@/shared/ui/dnd";
import { titleOf } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

export const canDropOnPlaylist = (permissions: Partial<Permissions>) =>
	canChangePlaylists(permissions);

export function useTrackDragSource({
	rows,
	source,
	selection,
}: {
	rows: TrackRows;
	source: LibrarySource;
	selection: Set<number>;
}) {
	const { data: playlists = [] } = usePlaylists();
	const permissions = usePermissions();
	const addTracks = useAddTracks();
	const t = useTranslate();
	const { queueTracks } = useQueueTracks();

	return useDragSource<number[]>({
		getPayload: (event) => {
			const aimed = targetsFrom(event, rows.length, selection);
			if (!aimed) return null;
			const { index, positions } = aimed;

			const grabbed = titleOf(rows.at(index), t);

			return {
				count: positions.length,
				label:
					positions.length === 1
						? grabbed
						: t("track.andMore", {
								track: grabbed,
								count: positions.length - 1,
							}),
				items: positions.map((position) => rows.ref(position)),
			};
		},

		canDrop: (id) => {
			if (id === source.playlistId) return false;
			if (id === QUEUE_DROP_TARGET || queueDropIndex(id) !== null) return true;
			return canDropOnPlaylist(permissions);
		},

		onDrop: (id, payload) => {
			if (id === QUEUE_DROP_TARGET) {
				queueTracks({ source, itemIndices: payload.items });
				return;
			}

			const at = queueDropIndex(id);
			if (at !== null) {
				queueTracks({ source, itemIndices: payload.items, at });
				return;
			}

			const target = playlists.find((entry) => entry.id === id);
			if (target) addTracks({ source, target, itemIndices: payload.items });
		},
	});
}
