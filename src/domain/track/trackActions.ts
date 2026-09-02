import { Check, ListEnd, ListMusic, ListPlus, Star } from "lucide-react";

import type { PlaylistInfo } from "@/shared/api/types";
import type { ActionNode } from "@/shared/ui/ActionMenu";
import { withoutJeanPlaylists } from "./jeanPlaylists";
import type { LibrarySource } from "./librarySource";
import { MAX_STARS } from "./rating";
import { QUEUE_LIMIT } from "./useQueueTracks";

// Descending, and `No rating` below a separator as the only entry that takes
// something away. Plain entries with a check on the current value, since
// `ActionMenu` has no checkable row.
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

/**
 * What can be done to a set of tracks, wherever they were reached from.
 *
 * Shared by the list's context menu and the now-playing screen's ⋯ button, and
 * it exists so those two cannot drift into offering different things: the
 * playing track is the same kind of object as a row, it simply has no row.
 *
 * The rating submenu is passed in rather than built here -- the two callers
 * hold their track's rating in different shapes (a row array against a
 * now-playing column set), and neither shape belongs in the other's file.
 */
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
	// Not Jean's scratch playlist: it is where results are put to be played, and
	// the next search would empty it anyway.
	const targets = withoutJeanPlaylists(playlists).filter(
		(entry) => entry.id !== source.playlistId,
	);

	return [
		// Above the separator: the one action here about what happens next rather
		// than where a track lives.
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
