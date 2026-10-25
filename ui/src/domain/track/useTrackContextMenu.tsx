import { ListMusic, Music, Star } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useMemo,
	useState,
} from "react";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { artistOf, FIELD, titleOf, value } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { isWritableScale, rawRatingWith, starsOf } from "./rating";
import { useWrittenRating } from "./ratingStore";
import { ratingItems, trackActions } from "./trackActions";
import { positionsOf, rowTitleAt, targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";
import { RATING_FIELD, useTagWriting } from "./useTagWriter";

const sameList = (a: number[], b: number[]) =>
	a.length === b.length && a.every((entry, at) => entry === b[at]);

// The gestures go on the container, not the rows: a virtualised list unmounts a row under the
// pointer, and a handler per row is a handler per row.
export function useTrackContextMenu({
	rows,
	source,
	selection,
	onSelectOnly,
	onRemove,
}: {
	rows: TrackRows;
	source: LibrarySource;
	selection: Set<number>;
	onSelectOnly: (index: number) => void;
	onRemove?: (positions: number[]) => void;
}) {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);
	const addTracks = useAddTracks();
	const { queueTracks, canQueue, canControlPlayback } = useQueueTracks();
	const { rate, hasWritableAddress } = useTagWriting();
	const menu = useContextMenu();

	const [positions, setPositions] = useState<number[]>([]);

	const isPending = positions.length === 1 && rows.isPending(positions[0]);
	const rated =
		positions.length === 1 && !isPending ? rows.ref(positions[0]) : undefined;
	const written = useWrittenRating(rows.columns, rated);
	const rawRating =
		rated === undefined ? null : rawRatingWith(rows.at(positions[0]), written);

	const choose = (chosen: number[]) =>
		setPositions((current) => (sameList(current, chosen) ? current : chosen));

	// `adopt` is off for the hold: claiming the selection on pointer-down would undo the shift-click
	// in the same event.
	const aim = (event: ReactMouseEvent, { adopt }: { adopt: boolean }) => {
		const aimed = targetsFrom(event, rows.length, selection);
		if (!aimed) return false;

		if (adopt && !selection.has(aimed.index)) onSelectOnly(aimed.index);
		choose(adopt ? aimed.positions : [aimed.index]);
		return true;
	};

	const openForRow = (index: number, row: HTMLElement) => {
		if (!selection.has(index)) onSelectOnly(index);
		choose(positionsOf(index, selection));
		menu.openBeside(row);
	};

	const triggerProps = {
		...menu.triggerProps,
		onContextMenu: (event: ReactMouseEvent) => {
			if (!aim(event, { adopt: true })) return;
			menu.triggerProps.onContextMenu(event);
		},
		onPointerDown: (event: ReactPointerEvent) => {
			if (event.pointerType === "mouse") return;
			// Resolved now rather than when the hold fires, by which time the event is long gone.
			if (aim(event, { adopt: false })) menu.triggerProps.onPointerDown(event);
		},
	};

	const count = positions.length;

	const actions = useMemo(() => {
		if (count === 0) return [];

		const itemIndices = positions.map((position) => rows.ref(position));
		const rateable =
			rated !== undefined &&
			isWritableScale(rawRating) &&
			hasWritableAddress(RATING_FIELD, source.addresses(rated));

		return trackActions({
			count,
			source,
			itemIndices,
			playlists,
			canWritePlaylists,
			canQueue,
			canControlPlayback,
			queueTracks,
			addTracks: (options) =>
				addTracks({
					...options,
					titleOf: (ref) =>
						rowTitleAt(rows, positions[itemIndices.indexOf(ref)], t),
				}),
			removeTracks: onRemove && (() => onRemove(positions)),
			credit:
				count === 1 && !isPending
					? value(rows.at(positions[0]), FIELD.artist)
					: null,
			t,
			rating: rateable
				? {
						id: "rate",
						label: t("rating.title"),
						icon: Star,
						items: ratingItems(
							starsOf(rawRating),
							(stars) =>
								rate(
									{ source, ref: itemIndices[0], columns: rows.columns },
									stars,
								),
							t,
						),
					}
				: null,
		});
	}, [
		count,
		positions,
		rows,
		playlists,
		source,
		canWritePlaylists,
		addTracks,
		onRemove,
		canQueue,
		canControlPlayback,
		queueTracks,
		rate,
		hasWritableAddress,
		rated,
		rawRating,
		isPending,
		t,
	]);

	const header = useMemo(() => {
		if (count === 0) return null;
		if (count > 1) {
			return {
				icon: ListMusic,
				title: t("view.trackCount", { count, total: count }),
				subtitle: t("track.selected"),
			};
		}

		if (rows.isPending(positions[0]))
			return { icon: Music, title: t("menu.actions"), isBusy: true };

		const row = rows.at(positions[0]);
		return {
			icon: Music,
			title: titleOf(row, t),
			subtitle: artistOf(row, t),
		};
	}, [count, positions, rows, t]);

	const element = (
		<ActionMenu
			isOpen={menu.isOpen && count > 0}
			anchor={menu.anchor}
			header={header}
			actions={actions}
			onDismiss={menu.close}
		/>
	);

	return { triggerProps, element, openForRow };
}
