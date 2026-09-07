import { Check, ListEnd, ListMusic, ListPlus, Star, User } from "lucide-react";
import { artistHref } from "@/domain/track/artistRoute";
import type { PlaylistInfo } from "@/shared/api/types";
import type { ActionNode } from "@/shared/ui/ActionMenu";
import { namesAnArtist } from "./artists";
import { creditedArtists } from "./fields";
import { withoutJeanPlaylists } from "./jeanPlaylists";
import type { LibrarySource } from "./librarySource";
import { MAX_STARS } from "./rating";
import { QUEUE_LIMIT } from "./useQueueTracks";

export const ratingItems = (
	current: number | null,
	onRate: (stars: number | null) => void,
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
		onSelect: () => onRate(null),
	},
];

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
	credit,
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
	rating: ActionNode | null;
	// The `%artist%` line of the one track this is about. A track list gives its rows no artist link
	// of their own -- playing is what a row is for, and a link inside one is a target a finger misses
	// -- so this is where an artist is reachable from a row at all.
	credit?: string | null;
}): ActionNode[] {
	const targets = withoutJeanPlaylists(playlists).filter(
		(entry) => entry.id !== source.playlistId,
	);

	// Setting the hash is what a link elsewhere in the app does; there is nothing else to navigate with
	// from inside a menu.
	const goTo = (name: string) => () => {
		window.location.hash = artistHref(name);
	};

	const { lead, guests } = creditedArtists(count === 1 ? credit : null);
	const named = [lead, ...guests].filter((name): name is string =>
		namesAnArtist(name),
	);

	const first = named[0];
	const artist: ActionNode[] = !first
		? []
		: named.length === 1
			? [
					{
						id: "artist",
						label: `Go to ${first}`,
						icon: User,
						onSelect: goTo(first),
					},
				]
			: [
					{
						id: "artist",
						label: "Go to artist",
						icon: User,
						items: named.map((name) => ({
							id: `artist-${name}`,
							label: name,
							icon: User,
							onSelect: goTo(name),
						})),
					},
				];

	return [
		...artist,
		...(artist.length > 0 ? [{ type: "separator" as const }] : []),
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
