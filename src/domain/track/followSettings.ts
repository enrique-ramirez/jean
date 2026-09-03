import { useStoredState } from "@/shared/hooks/useStoredState";

// Neither setting is readable from the player, so both are local. The stored key predates the rename and must keep it, or an existing preference resets.
export const useCursorFollowsPlayback = () =>
	useStoredState("jean.followPlayback", true);

export const usePlaybackFollowsCursor = () =>
	useStoredState("jean.playbackFollowsCursor", false);
