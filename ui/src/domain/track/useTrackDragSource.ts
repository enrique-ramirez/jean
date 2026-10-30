import { useMemo } from "react";

import { QUEUE_DROP_TARGET, queueDropIndex } from "@/domain/player/queue";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Translate } from "@/shared/i18n/locale";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type DragPayload, useDragSource } from "@/shared/ui/dnd";
import { type AlbumSpan, headingOf } from "./grouping";
import { type LibrarySource, playlistSourceOf } from "./librarySource";
import type { TrackRows } from "./project";
import {
	albumFrom,
	REORDER_DROP_TARGET,
	rowTitleAt,
	targetsFrom,
} from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";

type Reorder = (positions: number[], gap: number) => void;

const titlesOf = (rows: TrackRows, t: Translate) => (position: number) =>
	rowTitleAt(rows, position, t);

function useTrackDrop(
	source: LibrarySource | null,
	titleAt: (position: number) => string,
	onReorder?: Reorder,
) {
	const { data: playlists = [] } = usePlaylists();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);
	const addTracks = useAddTracks();
	const { queueTracks } = useQueueTracks();

	return {
		canDrop: (id: string) => {
			if (!source) return false;
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
			if (!source) return;
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
			if (!target) return;

			const { items, held = [] } = payload;
			addTracks({
				source,
				target,
				itemIndices: items,
				titleOf: (ref) => titleAt(held[items.indexOf(ref)]),
			});
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
	const drop = useTrackDrop(source, titlesOf(rows, t), onReorder);

	return useDragSource<number[]>({
		getPayload: (event) => {
			const aimed = targetsFrom(event, rows.length, selection);
			if (!aimed) return null;
			const fromGrip = event.pointerType !== "mouse";
			const { index } = aimed;
			const positions = fromGrip ? [index] : aimed.positions;

			const grabbed = rowTitleAt(rows, index, t);

			return {
				count: positions.length,
				label: rows.isPending(index)
					? t("view.trackCount", {
							count: positions.length,
							total: positions.length,
						})
					: positions.length === 1
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
	groups: AlbumSpan[];
	source: LibrarySource;
	onReorder?: Reorder;
}) {
	const t = useTranslate();
	const drop = useTrackDrop(source, titlesOf(rows, t), onReorder);

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
				label: headingOf(album, rows)?.album ?? t("track.unknownAlbum"),
				held: positions,
				items: positions.map((position) => rows.ref(position)),
			};
		},
		...drop,
	});
}

export function usePlayingTrackDragSource({
	playlistId,
	index,
	title,
}: {
	playlistId: string | null;
	index: number;
	title: string | null;
}) {
	const { discovery } = useFooJean();
	const { origin } = discovery;
	const source = useMemo(
		() => (playlistId ? playlistSourceOf({ playlistId, origin }) : null),
		[playlistId, origin],
	);
	const drop = useTrackDrop(source, () => title ?? "");

	return useDragSource<number[]>({
		getPayload: () =>
			source && index >= 0 && title
				? { count: 1, label: title, held: [index], items: [index] }
				: null,
		...drop,
	});
}
