import { Check, ListEnd, ListMusic, ListPlus, Star } from "lucide-react";

import type { PlaylistInfo } from "@/shared/api/types";
import type { ActionNode } from "@/shared/ui/ActionMenu";
import { withoutJeanPlaylists } from "./jeanPlaylists";
import type { LibrarySource } from "./librarySource";
import { MAX_STARS } from "./rating";
import { QUEUE_LIMIT } from "./useQueueTracks";

// Plain entries with a check on the current value, since `ActionMenu` has no checkable row.
export const ratingItems = (
	current: number | null,
	onRate: (stars: number) => void,
): ActionNode[] => [
	...Array.from({ length: MAX_STARS }, (_, at) => {
		const stars = MAX_STARS - at;
		return {
			id: `rate-${stars}`,
			label: stars === 1 ? "1 star" : `${stars} stars`,
			icon: stars === current ? Check : Star,
			onSelect: () => onRate(stars),
		};
	}),
	{ type: "separator" as const },
	{
		id: "rate-none",
		label: "No rating",
		icon: current === null ? Check : undefined,
		onSelect: () => onRate(0),
	},
];

// Shared by the list's context menu and the now-playing screen, so the two cannot drift into offering different things.
// The rating submenu is passed in rather than built here, because the two callers hold a rating in different shapes.
export function trackActions({
	count,
	source,
	itemIndices,
	playlists,
	canEdit,
	canQueue,
	queueTracks,
	addTracks,
	rating,
}: {
	count: number;
	source: LibrarySource;
	itemIndices: number[];
	playlists: PlaylistInfo[];
	canEdit: boolean;
	canQueue: boolean;
	queueTracks: (options: {
		source: LibrarySource;
		itemIndices: number[];
	}) => void;
	addTracks: (options: {
		source: LibrarySource;
		target: PlaylistInfo;
		itemIndices: number[];
	}) => void;
	// Null where the track's scale is somebody else's, or nothing can write.
	rating: ActionNode | null;
}): ActionNode[] {
	// Not Jean's own playlists: the scratch is where results are put to be played, and the next search would empty it anyway.
	const targets = withoutJeanPlaylists(playlists).filter(
		(entry) => entry.id !== source.playlistId,
	);

	return [
		{
			id: "queue",
			label:
				count > QUEUE_LIMIT
					? `Add to queue (${QUEUE_LIMIT} at a time)`
					: "Add to queue",
			icon: ListEnd,
			disabled: !canQueue || count > QUEUE_LIMIT,
			onSelect: () => queueTracks({ source, itemIndices }),
		},
		...(rating ? [rating] : []),
		{ type: "separator" as const },
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
}
