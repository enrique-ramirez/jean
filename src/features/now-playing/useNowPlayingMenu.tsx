import { Music, Star } from "lucide-react";
import { useMemo, useState } from "react";

import {
	useAudiblePlayer,
	usePermissions,
	usePlaylists,
} from "@/domain/player/usePlayer";
import { librarySourceOf } from "@/domain/track/librarySource";
import {
	isWritableScale,
	rawRatingOfValue,
	starsOf,
} from "@/domain/track/rating";
import { ratingItems, trackActions } from "@/domain/track/trackActions";
import { useAddTracks } from "@/domain/track/useAddTracks";
import { useQueueTracks } from "@/domain/track/useQueueTracks";
import { useTagWriting } from "@/domain/track/useTagWriter";
import { readTrack } from "@/shared/api/beefweb";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

// The same actions a row offers, on the playing track, built from `trackActions` so the two cannot drift.
// The source is always a playlist: a set out of the media library is materialised into the scratch playlist before it is played.
export function useNowPlayingMenu() {
	const snapshot = useAudiblePlayer();
	const { data: playlists = [] } = usePlaylists();
	const permissions = usePermissions();
	const { details, setRating } = useNowPlayingTrack();
	const { queueTracks, canQueue } = useQueueTracks();
	const { canRate, rateTrack } = useTagWriting();
	const addTracks = useAddTracks();

	const [isOpen, setIsOpen] = useState(false);
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

	const item = snapshot?.player?.activeItem;
	const track = readTrack(snapshot?.player);
	const hasTrack = Boolean(item && item.index >= 0);

	const source = useMemo(
		() =>
			item?.playlistId
				? librarySourceOf({ kind: "playlist", playlistId: item.playlistId })
				: null,
		[item?.playlistId],
	);

	const raw =
		details === null
			? null
			: rawRatingOfValue(details.row[NOW_PLAYING_FIELD.rating]);

	const actions = useMemo(() => {
		if (!source || !hasTrack || !item) return [];

		return trackActions({
			count: 1,
			source,
			itemIndices: [item.index],
			playlists,
			canEdit: permissions.changePlaylists !== false,
			canQueue,
			queueTracks,
			addTracks,
			rating:
				canRate && track && isWritableScale(raw)
					? {
							id: "rate",
							label: "Rating",
							icon: Star,
							items: ratingItems(starsOf(raw), (stars: number) => {
								setRating(stars === 0 ? "" : String(stars));
								rateTrack(track, track.title, stars === 0 ? null : stars);
							}),
						}
					: null,
		});
	}, [
		source,
		hasTrack,
		item,
		playlists,
		permissions,
		canQueue,
		queueTracks,
		addTracks,
		canRate,
		track,
		raw,
		rateTrack,
		setRating,
	]);

	const element = (
		<ActionMenu
			isOpen={isOpen && actions.length > 0}
			anchor={anchor}
			header={
				track
					? { icon: Music, title: track.title, subtitle: track.artist }
					: null
			}
			actions={actions}
			onDismiss={() => setIsOpen(false)}
		/>
	);

	return {
		element,
		isOpen,
		open: (event: { currentTarget: HTMLElement }) => {
			const box = event.currentTarget.getBoundingClientRect();
			setAnchor({ x: box.left, y: box.bottom });
			setIsOpen(true);
		},
	};
}
