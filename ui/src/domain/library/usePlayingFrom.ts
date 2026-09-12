import { useMemo } from "react";
import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
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
	const activePlaylistId = snapshot?.player?.activeItem?.playlistId ?? null;
	const [landedTitle] = useStoredState<string | null>(SCRATCH_LANDED_KEY, null);

	return useMemo(() => {
		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return null;

		// A client that filled the scratch itself trusts what it filled over the playlist's own
		// title, which foo_jean may have already changed for a fill this client has not heard back
		// from yet. A client that filled nothing still reads the title, which is the only account
		// another device's fill leaves behind.
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
