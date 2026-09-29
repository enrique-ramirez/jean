import { useMemo } from "react";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import {
	usePlaylists,
	useResolvedPlaylistId,
} from "@/domain/player/usePlaylists";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchName,
} from "@/domain/track/jeanPlaylists";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { titledAsLanded, useLandedScratch } from "./useScratchPlaylist";

export function usePlayingFrom() {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const snapshot = useAudiblePlayer();
	const activePlaylistId = useResolvedPlaylistId(
		snapshot?.player?.activeItem?.playlistGuid ?? null,
	);
	const scratch = playlists.find(isScratchPlaylist) ?? null;
	const landed = useLandedScratch(scratch);

	return useMemo(() => {
		if (!scratch) return null;

		const held = scratchContentsOf(titledAsLanded(scratch, landed));
		if (!held) return null;
		const name = scratchName(held, t);
		if (!name) return null;

		return {
			...held,
			name,
			itemCount: scratch.itemCount,
			isPlaying: activePlaylistId === scratch.id,
		};
	}, [scratch, activePlaylistId, t, landed]);
}
