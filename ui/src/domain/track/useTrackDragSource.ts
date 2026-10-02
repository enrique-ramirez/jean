import { QUEUE_DROP_TARGET, queueDropIndex } from "@/domain/player/queue";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type DragPayload, useDragSource } from "@/shared/ui/dnd";
import { titleOf } from "./fields";
import type { AlbumRun } from "./grouping";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { albumFrom, REORDER_DROP_TARGET, targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

type Reorder = (positions: number[], gap: number) => void;

function useTrackDrop(source: LibrarySource, onReorder: Reorder | undefined) {
	const { data: playlists = [] } = usePlaylists();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);
	const addTracks = useAddTracks();
	const { queueTracks } = useQueueTracks();

	return {
		canDrop: (id: string) => {
			if (id === REORDER_DROP_TARGET) return onReorder !== undefined;
			if (id === source.playlistId) return false;
			if (id === QUEUE_DROP_TARGET || queueDropIndex(id) !== null) return true;
			return canWritePlaylists;
		},

		onDrop: (
			id: string,
			payload: DragPayload<number[]>,
			gap: number | null,
		) => {
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
	};
}

export function useTrackDragSource({
	rows,
	source,
	selection,
	onReorder,
}: {
	rows: TrackRows;
	source: LibrarySource;
	selection: Set<number>;
	onReorder?: Reorder;
}) {
	const t = useTranslate();
	const drop = useTrackDrop(source, onReorder);

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
		...drop,
	});
}

export function useAlbumDragSource({
	rows,
	groups,
	source,
	onReorder,
}: {
	rows: TrackRows;
	groups: AlbumRun[];
	source: LibrarySource;
	onReorder?: Reorder;
}) {
	const drop = useTrackDrop(source, onReorder);

	return useDragSource<number[]>({
		getPayload: (event) => {
			const album = albumFrom(event, groups);
			if (!album) return null;
			const positions = Array.from(
				{ length: album.count },
				(_, offset) => album.start + offset,
			);

			return {
				count: album.count,
				label: album.album,
				held: positions,
				items: positions.map((position) => rows.ref(position)),
			};
		},
		...drop,
	});
}
