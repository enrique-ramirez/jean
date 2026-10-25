import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import {
	type WindowedState,
	windowedLibraryOf,
} from "@/domain/track/libraryWindows";
import { libraryOrigin } from "@/shared/api/discovery";
import { playingTrack } from "@/shared/api/playerState";
import { useFooJean } from "@/shared/hooks/useFooJean";

const NOTHING = () => () => {};

const NO_STATE: WindowedState = {
	list: null,
	version: 0,
	runs: null,
	hasDiscs: false,
};

export interface PlayingLibrary {
	ordinal: number | null;
	structure: number | null;
	coverUrl: string | null;
	isCoverPending: boolean;
}

export const playingArtwork = (
	{ coverUrl, isCoverPending }: PlayingLibrary,
	playingCover: string | null,
) => coverUrl ?? (isCoverPending ? null : playingCover);

export function usePlayingLibrary(): PlayingLibrary {
	const { discovery } = useFooJean();
	const origin = libraryOrigin(discovery);
	const snapshot = useAudiblePlayer();
	const ordinal = playingTrack(snapshot?.player)?.libraryOrdinal ?? null;
	// A track of no album has the cover of its own file, which only the playing cover route reads.
	const coverOrdinal = snapshot?.player?.activeItem?.album ? ordinal : null;

	const watched = useMemo(
		() => (origin && ordinal !== null ? windowedLibraryOf(origin) : null),
		[origin, ordinal],
	);
	const state = useSyncExternalStore(
		watched ? watched.subscribe : NOTHING,
		watched ? watched.state : () => NO_STATE,
	);

	useEffect(
		() =>
			watched && coverOrdinal !== null
				? watched.watchPlaying(coverOrdinal)
				: undefined,
		[watched, coverOrdinal],
	);

	const coverUrl =
		watched && coverOrdinal !== null ? watched.coverUrlOf(coverOrdinal) : null;

	const structure = state.list?.structure ?? null;
	const isCoverPending =
		watched !== null && coverOrdinal !== null && coverUrl === null;

	return useMemo(
		() => ({ ordinal, structure, coverUrl, isCoverPending }),
		[ordinal, structure, coverUrl, isCoverPending],
	);
}
