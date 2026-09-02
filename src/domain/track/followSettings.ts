import { useStoredState } from "@/shared/hooks/useStoredState";

// Neither is readable from the player; see the root CLAUDE.md. The key predates
// the rename and must keep it, or an existing preference resets.
export const useCursorFollowsPlayback = () =>
	useStoredState("jean.followPlayback", true);

export const usePlaybackFollowsCursor = () =>
	useStoredState("jean.playbackFollowsCursor", false);
