import { usePlayingLibrary } from "@/domain/library/usePlayingLibrary";
import {
	type TrackMembers,
	useTrackMembers,
} from "@/domain/track/useTrackMembers";

export function usePlayingMembers(): TrackMembers {
	const { ordinal, structure } = usePlayingLibrary();
	return useTrackMembers(
		ordinal !== null && structure !== null ? { structure, ordinal } : null,
	);
}
