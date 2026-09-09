import { useMemo } from "react";
import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchName,
} from "@/domain/track/jeanPlaylists";
import { useTranslate } from "@/shared/i18n/useTranslate";

export function usePlayingFrom() {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const snapshot = useAudiblePlayer();
	const activePlaylistId = snapshot?.player?.activeItem?.playlistId ?? null;

	return useMemo(() => {
		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return null;

		const held = scratchContentsOf(scratch);
		if (!held) return null;
		const name = scratchName(held, t);
		if (!name) return null;

		return {
			...held,
			name,
			isPlaying: activePlaylistId === scratch.id,
		};
	}, [playlists, activePlaylistId, t]);
}
