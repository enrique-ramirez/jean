import { useEffect, useRef } from "react";
import { usePlayer, usePlaylists } from "@/domain/player/usePlayer";
import { ROUTE } from "@/domain/track/routes";

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

	const resumed = useRef(false);
	useEffect(() => {
		if (resumed.current || !hasPlayer || !hasPlaylists) return;
		if (activeItem?.playlistGuid && playingPlaylistId === undefined) return;
		resumed.current = true;
		if (route !== "" || !activeItem || activeItem.index < 0) return;

		if (playingRoute) onArrive(playingRoute);
		navigate(`/${ROUTE.playing}`);
	}, [
		route,
		hasPlayer,
		hasPlaylists,
		activeItem,
		playingRoute,
		playingPlaylistId,
		navigate,
		onArrive,
	]);
}
