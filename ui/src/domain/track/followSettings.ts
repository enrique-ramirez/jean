import { useStoredState } from "@/shared/hooks/useStoredState";

export const useCursorFollowsPlayback = () =>
	useStoredState("jean.followPlayback", true);

export const usePlaybackFollowsCursor = () =>
	useStoredState("jean.playbackFollowsCursor", false);
