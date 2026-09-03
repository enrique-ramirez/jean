import { useMemo } from "react";

import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchName,
} from "@/domain/track/jeanPlaylists";

// Where playback is coming from, when that is a set Jean materialised rather than a playlist the user can see.
// Read off the scratch playlist's own title, so this needs no state of Jean's own and survives a reload.
export function usePlayingFrom() {
	const { data: playlists = [] } = usePlaylists();
	const snapshot = useAudiblePlayer();
	const activePlaylistId = snapshot?.player?.activeItem?.playlistId ?? null;

	return useMemo(() => {
		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return null;

		const held = scratchContentsOf(scratch);
		if (!held) return null;
		// Named rather than labelled: All music carries no label at all.
		const name = scratchName(held);
		if (!name) return null;

		return {
			...held,
			name,
			// The active item's playlist, not `isCurrent`: that keeps pointing at the last playlist played from long after playback stopped.
			isPlaying: activePlaylistId === scratch.id,
		};
	}, [playlists, activePlaylistId]);
}
