import {
	Check,
	ListEnd,
	ListMusic,
	ListPlus,
	ListX,
	Star,
	User,
} from "lucide-react";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Translate } from "@/shared/i18n/locale";
import type { ActionNode } from "@/shared/ui/ActionMenu";
import { creditedArtists, namesAnArtist } from "./fields";
import { withoutScratchPlaylist } from "./jeanPlaylists";
import type { LibrarySource } from "./librarySource";
import { MAX_STARS } from "./rating";
import { artistRoute, href } from "./routes";
import { QUEUE_LIMIT } from "./useQueueTracks";

export const ratingItems = (
	current: number | null,
	onRate: (stars: number | null) => void,
	t: Translate,
): ActionNode[] => [
	...Array.from({ length: MAX_STARS }, (_, at) => {
		const stars = MAX_STARS - at;
		return {
			id: `rate-${stars}`,
			label: t("rating.stars", { count: stars }),
			icon: stars === current ? Check : Star,
			onSelect: () => onRate(stars),
		};
	}),
	{ type: "separator" as const },
	{
		id: "rate-none",
		label: t("rating.none"),
		icon: current === null ? Check : undefined,
		onSelect: () => onRate(null),
	},
];

export function trackActions({
	count,
	source,
	itemIndices,
	playlists,
	canWritePlaylists,
	canQueue,
	canControlPlayback,
	queueTracks,
	addTracks,
	removeTracks,
	rating,
	credit,
	t,
}: {
	count: number;
	source: LibrarySource;
	itemIndices: number[];
	playlists: PlaylistInfo[];
	canWritePlaylists: boolean;
	canQueue: boolean;
	canControlPlayback: boolean;
	queueTracks: (options: {
		source: LibrarySource;
		itemIndices: number[];
	}) => void;
	addTracks: (options: {
		source: LibrarySource;
		target: PlaylistInfo;
		itemIndices: number[];
	}) => void;
	removeTracks?: () => void;
	rating: ActionNode | null;
	t: Translate;
	// The `%artist%` line of the one track this is about. A track list gives its rows no artist link
	// of their own -- playing is what a row is for, and a link inside one is a target a finger misses
	// -- so this is where an artist is reachable from a row at all.
	credit?: string | null;
}): ActionNode[] {
	const targets = withoutScratchPlaylist(playlists).filter(
		(entry) => entry.id !== source.playlistId,
	);

	// Setting the hash is what a link elsewhere in the app does; there is nothing else to navigate with
	// from inside a menu.
	const goTo = (name: string) => () => {
		window.location.hash = href(artistRoute(name));
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
						label: t("track.goToNamed", { artist: first }),
						icon: User,
						onSelect: goTo(first),
					},
				]
			: [
					{
						id: "artist",
						label: t("track.goToArtist"),
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
			label: !canControlPlayback
				? t("player.controlOffName", { control: t("track.queue") })
				: count > QUEUE_LIMIT
					? t("track.queueLimited", { limit: QUEUE_LIMIT })
					: t("track.queue"),
			icon: ListEnd,
			disabled: !canQueue || count > QUEUE_LIMIT,
			onSelect: () => queueTracks({ source, itemIndices }),
		},
		...(rating ? [rating] : []),
		...(canWritePlaylists
			? [
					{ type: "separator" as const },
					{
						id: "add",
						label: t("track.addToPlaylist"),
						icon: ListPlus,
						disabled: targets.length === 0,
						filter: t("track.findPlaylist"),
						items: targets.map((target) => ({
							id: target.id,
							label: target.title,
							icon: ListMusic,
							onSelect: () => addTracks({ source, target, itemIndices }),
						})),
					},
				]
			: []),
		...(removeTracks
			? [
					{ type: "separator" as const },
					{
						id: "remove",
						label: t("track.removeFromPlaylist"),
						icon: ListX,
						danger: true,
						onSelect: removeTracks,
					},
				]
			: []),
	];
}
