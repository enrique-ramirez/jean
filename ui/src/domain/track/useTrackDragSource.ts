import { QUEUE_DROP_TARGET, queueDropIndex } from "@/domain/player/queue";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useDragSource } from "@/shared/ui/dnd";
import { titleOf } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { REORDER_DROP_TARGET, targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

export function useTrackDragSource({
	rows,
	source,
	selection,
	onReorder,
}: {
	rows: TrackRows;
	source: LibrarySource;
	selection: Set<number>;
	onReorder?: (positions: number[], gap: number) => void;
}) {
	const { data: playlists = [] } = usePlaylists();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);
	const addTracks = useAddTracks();
	const t = useTranslate();
	const { queueTracks } = useQueueTracks();

	return useDragSource<number[]>({
		getPayload: (event) => {
			const aimed = targetsFrom(event, rows.length, selection);
			if (!aimed) return null;
			const fromGrip = event.pointerType !== "mouse";
			const { index } = aimed;
			const positions = fromGrip ? [index] : aimed.positions;

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
				origin: index,
				held: positions,
				items: positions.map((position) => rows.ref(position)),
				...(fromGrip ? { within: REORDER_DROP_TARGET } : null),
			};
		},

		canDrop: (id) => {
			if (id === REORDER_DROP_TARGET) return onReorder !== undefined;
			if (id === source.playlistId) return false;
			if (id === QUEUE_DROP_TARGET || queueDropIndex(id) !== null) return true;
			return canWritePlaylists;
		},

		onDrop: (id, payload, gap) => {
			if (id === REORDER_DROP_TARGET) {
				if (gap !== null) onReorder?.(payload.items, gap);
				return;
			}

			if (id === QUEUE_DROP_TARGET) {
				queueTracks({ source, itemIndices: payload.items, drag: true });
				return;
			}

			const at = queueDropIndex(id);
			if (at !== null) {
				queueTracks({ source, itemIndices: payload.items, at, drag: true });
				return;
			}

			const target = playlists.find((entry) => entry.id === id);
			if (target) addTracks({ source, target, itemIndices: payload.items });
		},
	});
}
