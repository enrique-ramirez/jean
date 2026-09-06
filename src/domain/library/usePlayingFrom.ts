import { useMemo } from "react";

import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchName,
} from "@/domain/track/jeanPlaylists";

export function usePlayingFrom() {
	const { data: playlists = [] } = usePlaylists();
	const snapshot = useAudiblePlayer();
	const activePlaylistId = snapshot?.player?.activeItem?.playlistId ?? null;

	return useMemo(() => {
		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return null;

		const held = scratchContentsOf(scratch);
		if (!held) return null;
		const name = scratchName(held);
		if (!name) return null;

		return {
			...held,
			name,
			isPlaying: activePlaylistId === scratch.id,
		};
	}, [playlists, activePlaylistId]);
}
