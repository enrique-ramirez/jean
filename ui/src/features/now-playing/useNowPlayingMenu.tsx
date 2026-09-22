import { Music, Star } from "lucide-react";
import { useMemo, useState } from "react";
import {
	useAudiblePlayer,
	usePlaylists,
	useResolvedPlaylistId,
} from "@/domain/player/usePlayer";
import { librarySourceOf } from "@/domain/track/librarySource";
import { starsOf } from "@/domain/track/rating";
import { ratingItems, trackActions } from "@/domain/track/trackActions";
import { useAddTracks } from "@/domain/track/useAddTracks";
import { useQueueTracks } from "@/domain/track/useQueueTracks";
import { readTrack } from "@/shared/api/beefweb";
import { permitsPlaylistWrites } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { useNowPlayingRating } from "./useNowPlayingRating";

export function useNowPlayingMenu() {
	const t = useTranslate();
	const snapshot = useAudiblePlayer();
	const { data: playlists = [] } = usePlaylists();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);
	const { queueTracks, canQueue } = useQueueTracks();
	const { raw, canWrite, write } = useNowPlayingRating();
	const addTracks = useAddTracks();

	const [isOpen, setIsOpen] = useState(false);
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

	const item = snapshot?.player?.activeItem;
	const track = readTrack(snapshot?.player);
	const hasTrack = Boolean(track);
	const playingPlaylistId = useResolvedPlaylistId(item?.playlistGuid ?? null);
	const playingStructure = playlists.find(
		(playlist) => playlist.id === playingPlaylistId,
	)?.structure;

	const source = useMemo(
		() =>
			playingPlaylistId
				? librarySourceOf({
						kind: "playlist",
						playlistId: playingPlaylistId,
						origin: discovery.origin,
						token: discovery.token,
						structure: playingStructure,
					})
				: null,
		[playingPlaylistId, playingStructure, discovery.origin, discovery.token],
	);

	const actions = useMemo(() => {
		if (!hasTrack || !item) return [];

		const rating = canWrite
			? {
					id: "rate",
					label: t("rating.title"),
					icon: Star,
					items: ratingItems(starsOf(raw), write, t),
				}
			: null;

		if (!source) return rating ? [rating] : [];

		return trackActions({
			count: 1,
			source,
			itemIndices: [item.index],
			playlists,
			canWritePlaylists,
			canQueue,
			queueTracks,
			addTracks,
			credit: track?.artist,
			t,
			rating,
		});
	}, [
		source,
		hasTrack,
		item,
		track?.artist,
		playlists,
		canWritePlaylists,
		canQueue,
		queueTracks,
		addTracks,
		raw,
		canWrite,
		write,
		t,
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
