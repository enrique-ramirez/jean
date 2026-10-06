import { useEffect, useRef } from "react";
import { useInSession } from "@/domain/player/session";
import { usePlayer } from "@/domain/player/usePlayer";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { ROUTE } from "@/domain/track/routes";
import type { ActiveItem } from "@/shared/api/types";

// `foo_jean` answers a session's active item with an index of -1 whether or not it holds a track, so
// in a session the track is known by its path.
const holdsTrack = (
	activeItem: ActiveItem | undefined,
	isInSession: boolean,
) =>
	isInSession
		? Boolean(activeItem?.path)
		: activeItem !== undefined && activeItem.index >= 0;

export function useFrontDoor({
	route,
	playingRoute,
	playingPlaylistId,
	navigate,
	onArrive,
}: {
	route: string;
	playingRoute: string | null;
	playingPlaylistId: string | null | undefined;
	navigate: (to: string) => void;
	onArrive: (from: string) => void;
}) {
	const { data: playerState, isSuccess: hasPlayer } = usePlayer();
	const { isSuccess: hasPlaylists } = usePlaylists();
	const activeItem = playerState?.player?.activeItem;
	const isInSession = useInSession();

	const resumed = useRef(false);
	useEffect(() => {
		if (resumed.current || !hasPlayer || !hasPlaylists) return;
		if (activeItem?.playlistGuid && playingPlaylistId === undefined) return;
		resumed.current = true;
		if (route !== "" || !holdsTrack(activeItem, isInSession)) return;

		if (playingRoute) onArrive(playingRoute);
		navigate(`/${ROUTE.playing}`);
	}, [
		route,
		hasPlayer,
		hasPlaylists,
		activeItem,
		isInSession,
		playingRoute,
		playingPlaylistId,
		navigate,
		onArrive,
	]);
}
