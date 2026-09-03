import { ListMusic, Music, Star } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useMemo,
	useState,
} from "react";
import { usePermissions, usePlaylists } from "@/domain/player/usePlayer";
import type { TrackColumns } from "@/shared/api/types";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { plural } from "@/shared/lib/text";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { FIELD, value } from "./fields";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";
import {
	isWritableScale,
	rawRatingOf,
	rawRatingOfValue,
	starsOf,
} from "./rating";
import { useWrittenRating } from "./ratingStore";
import { ratingItems, trackActions } from "./trackActions";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";
import { useQueueTracks } from "./useQueueTracks";
import { useTagWriting } from "./useTagWriter";

const sameList = (a: number[], b: number[]) =>
	a.length === b.length && a.every((entry, at) => entry === b[at]);

// The gestures go on the container, not the rows: a virtualised list must not carry a handler per row, and it unmounts them under the pointer anyway.
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
	const { data: playlists = [] } = usePlaylists();
	const permissions = usePermissions();
	const addTracks = useAddTracks();
	const { queueTracks, canQueue } = useQueueTracks();
	const { canRate, rate } = useTagWriting();
	const menu = useContextMenu();

	// View positions, not playlist indices. The translation happens once, where the request is built.
	const [positions, setPositions] = useState<number[]>([]);

	// One track only: a rating over a whole selection is dozens of tag writes behind a single click, and an undo that is dozens more.
	const rated = positions.length === 1 ? rows[positions[0]] : undefined;
	const written = useWrittenRating(rated);
	const rawRating =
		rated === undefined
			? null
			: written === undefined
				? rawRatingOf(rated)
				: rawRatingOfValue(written);

	const canEdit = permissions.changePlaylists !== false;

	// Right-clicking inside a selection acts on all of it, outside one replaces it. That is why TrackRow ignores non-primary buttons: selecting on pointer-down would collapse the selection before the menu about to act on it opened.
	// `adopt` is off for the hold, because claiming the selection on pointer-down would undo the shift-click in the same event.
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
			// Only touch arms a hold, so a mouse does no work here: this fires on every click in a list of any size.
			if (event.pointerType === "mouse") return;
			// Resolved now rather than when the hold fires, by which time the event is long gone.
			if (aim(event, { adopt: false })) menu.triggerProps.onPointerDown(event);
		},
	};

	const count = positions.length;

	const actions = useMemo(() => {
		if (count === 0) return [];

		const itemIndices = positions.map((position) =>
			indices ? indices[position] : position,
		);
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
			rating: rateable
				? {
						id: "rate",
						label: "Rating",
						icon: Star,
						items: ratingItems(starsOf(rawRating), (stars: number) =>
							rate(
								{ source, ref: itemIndices[0], row: rated as TrackColumns },
								stars === 0 ? null : stars,
							),
						),
					}
				: null,
		});
	}, [
		count,
		positions,
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
	]);

	const header = useMemo(() => {
		if (count === 0) return null;
		if (count > 1) {
			return {
				icon: ListMusic,
				title: plural(count, "track"),
				subtitle: "Selected",
			};
		}

		const row = rows[positions[0]];
		return {
			icon: Music,
			title: value(row, FIELD.title) ?? "Unknown title",
			subtitle: value(row, FIELD.artist) ?? "Unknown artist",
		};
	}, [count, positions, rows]);

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
