import { ListMusic, Music, Star } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useMemo,
	useState,
} from "react";
import {
	canChangePlaylists,
	usePermissions,
	usePlaylists,
} from "@/domain/player/usePlayer";
import type { TrackColumns } from "@/shared/api/types";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { artistOf, FIELD, titleOf, value } from "./fields";
import type { LibrarySource } from "./librarySource";
import { type Refs, refAt } from "./project";
import { isWritableScale, rawRatingWith, starsOf } from "./rating";
import { useWrittenRating } from "./ratingStore";
import { ratingItems, trackActions } from "./trackActions";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";
import { useTagWriting } from "./useTagWriter";

const sameList = (a: number[], b: number[]) =>
	a.length === b.length && a.every((entry, at) => entry === b[at]);

// The gestures go on the container, not the rows: a virtualised list unmounts a row under the
// pointer, and a handler per row is a handler per row.
export function useTrackContextMenu({
	rows,
	indices,
	source,
	selection,
	onSelectOnly,
}: {
	rows: TrackColumns[];
	indices: Refs | null;
	source: LibrarySource;
	selection: Set<number>;
	onSelectOnly: (index: number) => void;
}) {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const permissions = usePermissions();
	const addTracks = useAddTracks();
	const { queueTracks, canQueue } = useQueueTracks();
	const { canRate, rate } = useTagWriting();
	const menu = useContextMenu();

	const [positions, setPositions] = useState<number[]>([]);

	const rated = positions.length === 1 ? rows[positions[0]] : undefined;
	const written = useWrittenRating(rated);
	const rawRating = rated === undefined ? null : rawRatingWith(rated, written);

	const canEdit = canChangePlaylists(permissions);

	// `adopt` is off for the hold: claiming the selection on pointer-down would undo the shift-click
	// in the same event.
	const aim = (event: ReactMouseEvent, { adopt }: { adopt: boolean }) => {
		const aimed = targetsFrom(event, rows, selection);
		if (!aimed) return false;

		const chosen = adopt ? aimed.positions : [aimed.index];
		if (adopt && !selection.has(aimed.index)) onSelectOnly(aimed.index);

		setPositions((current) => (sameList(current, chosen) ? current : chosen));
		return true;
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

		const itemIndices = positions.map((position) => refAt(indices, position));
		const rateable =
			canRate && rated !== undefined && isWritableScale(rawRating);

		return trackActions({
			count,
			source,
			itemIndices,
			playlists,
			canEdit,
			canQueue,
			queueTracks,
			addTracks,
			credit: count === 1 ? value(rows[positions[0]], FIELD.artist) : null,
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
									{ source, ref: itemIndices[0], row: rated as TrackColumns },
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
		indices,
		playlists,
		source,
		canEdit,
		addTracks,
		canQueue,
		queueTracks,
		canRate,
		rate,
		rated,
		rawRating,
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

		const row = rows[positions[0]];
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

	return { triggerProps, element };
}
