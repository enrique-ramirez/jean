import type { ActiveItem, PlayerSnapshot } from "@/shared/api/types";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { useAudibleSnapshot } from "./audible";
import { PLAYER_KEY } from "./playerPoll";
import { useResolvedPlaylistId } from "./usePlaylists";

export const usePlayer = () => useCacheOnly<PlayerSnapshot>(PLAYER_KEY);

export function useAudiblePlayer() {
	return useAudibleSnapshot(usePlayer().data);
}

export function useIsPlaying() {
	const { data } = usePlayer();
	return data?.player?.playbackState === "playing";
}

export function useActiveItem(
	playlistId: string | null | undefined,
): ActiveItem | null {
	const { data } = usePlayer();
	const item = data?.player?.activeItem;
	const playingId = useResolvedPlaylistId(item?.playlistGuid ?? null);
	if (!item || item.index < 0 || playingId !== playlistId) return null;
	return item;
}
