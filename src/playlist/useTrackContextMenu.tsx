import { ListMusic, ListPlus, Music } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useMemo,
	useState,
} from "react";
import type { TrackColumns } from "../api/types";
import { withoutJeanPlaylists } from "../library/jeanPlaylists";
import type { LibrarySource } from "../library/librarySource";
import type { Refs } from "../library/project";
import { usePermissions, usePlaylists } from "../player/usePlayer";
import { ActionMenu } from "../ui/ActionMenu";
import { plural } from "../ui/text";
import { useContextMenu } from "../ui/useContextMenu";
import { FIELD, value } from "./fields";
import { targetsFrom } from "./trackTargets";
import { useAddTracks } from "./useAddTracks";

const sameList = (a: number[], b: number[]) =>
	a.length === b.length && a.every((entry, at) => entry === b[at]);

// One menu for a list of any length. The gestures go on the container, not on
// the rows: a virtualised list must not carry a handler per row, and it unmounts
// them under the pointer anyway. Which row was hit is read back out of the DOM
// at the moment it is asked for.
//
// Returns the JSX as well as the props, the way usePanel does inside ActionMenu
// -- the alternative is lifting two pieces of state into a component that is
// already holding fifteen.
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
	const menu = useContextMenu();

	// View positions, not playlist indices. The translation happens once, where
	// the request is built.
	const [positions, setPositions] = useState<number[]>([]);

	const canEdit = permissions.changePlaylists !== false;

	// Right-clicking inside a selection acts on all of it; right-clicking outside
	// one replaces it -- the rule every file manager uses, and the reason TrackRow
	// ignores non-primary buttons, since selecting on pointer-down would collapse
	// the selection before the menu that is about to act on it ever opened.
	//
	// `adopt` is off for the hold, and that is not a shortcut. Claiming the
	// selection on pointer-down would undo the shift-click that just happened in
	// the same event, and on touch there is nothing to adopt anyway: there are no
	// modifier keys, so TrackRow has already made the pressed row the selection.
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
			// Only touch arms a hold, so a mouse does no work here at all -- this
			// fires on every click in a thirty-thousand row list.
			if (event.pointerType === "mouse") return;
			// Resolved now rather than when the hold fires: by then the pointer has
			// been down for four hundred milliseconds and the event is long gone.
			if (aim(event, { adopt: false })) menu.triggerProps.onPointerDown(event);
		},
	};

	const count = positions.length;

	const actions = useMemo(() => {
		if (count === 0) return [];

		const itemIndices = positions.map((position) =>
			indices ? indices[position] : position,
		);
		// Not the one you are already in, and not Jean's own scratch playlist --
		// that is a place results are put to be played, not a playlist anyone
		// should be able to file tracks into. It would be emptied by the next
		// search anyway.
		const targets = withoutJeanPlaylists(playlists).filter(
			(entry) => entry.id !== source.playlistId,
		);

		return [
			{
				id: "add",
				label: "Add to playlist",
				icon: ListPlus,
				disabled: !canEdit || targets.length === 0,
				filter: "Find a playlist",
				items: targets.map((target) => ({
					id: target.id,
					label: target.title,
					icon: ListMusic,
					onSelect: () => addTracks({ source, target, itemIndices }),
				})),
			},
		];
	}, [count, positions, indices, playlists, source, canEdit, addTracks]);

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
