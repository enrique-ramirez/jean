import { useMemo } from "react";
import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
import { usePlayingPlaylist } from "@/domain/player/usePlayingPlaylist";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchName,
} from "@/domain/track/jeanPlaylists";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCRATCH_LANDED_KEY } from "./useScratchPlaylist";

export function usePlayingFrom() {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const snapshot = useAudiblePlayer();
	const activePlaylistId = usePlayingPlaylist(
		snapshot?.player?.activeItem?.playlistGuid ?? null,
	);
	const [landedTitle] = useStoredState<string | null>(SCRATCH_LANDED_KEY, null);

	return useMemo(() => {
		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return null;

		// Preferred over the playlist's own title everywhere it is read; domain/library/CLAUDE.md has why.
		const held = scratchContentsOf(
			landedTitle ? { ...scratch, title: landedTitle } : scratch,
		);
		if (!held) return null;
		const name = scratchName(held, t);
		if (!name) return null;

		return {
			...held,
			name,
			isPlaying: activePlaylistId === scratch.id,
		};
	}, [playlists, activePlaylistId, t, landedTitle]);
}
