import { useMemo } from "react";
import { creditMembers, type Member } from "@/domain/artist/credits";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import { useLibrary } from "@/domain/library/useLibrary";
import { CREDIT_TAGS } from "@/domain/track/fields";
import { isLoaded } from "@/domain/track/libraryColumns";
import { wholeLibrary } from "@/domain/track/project";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

export interface PlayingMembers {
	artist: readonly Member[];
	albumArtist: readonly Member[];
}

const NOBODY: PlayingMembers = { artist: [], albumArtist: [] };

export function usePlayingMembers(): PlayingMembers {
	const { snapshot, source } = useLibrary();
	const [guesses] = useSplitCredits();
	const { track } = useNowPlayingTrack();
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;

	return useMemo(() => {
		if (path === null || !isLoaded(snapshot.columns, CREDIT_TAGS))
			return NOBODY;
		const ref = source.playingPosition(wholeLibrary(snapshot).indices, {
			path,
			subsong,
		});
		if (ref < 0) return NOBODY;
		const members = creditMembers(snapshot.columns, guesses);
		return {
			artist: members.artist(ref),
			albumArtist: members.albumArtist(ref),
		};
	}, [snapshot, source, path, subsong, guesses]);
}
