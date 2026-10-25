import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Member } from "@/domain/artist/credits";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import { usePlayingLibrary } from "@/domain/library/usePlayingLibrary";
import { LIBRARY_ROLES, readColumnMoved } from "@/domain/track/libraryAsker";
import { announcedLibraryOf, watchLibrary } from "@/domain/track/libraryHolds";
import { libraryOrigin } from "@/shared/api/discovery";
import { fetchLibraryCredits } from "@/shared/api/libraryCredits";
import { useFooJean } from "@/shared/hooks/useFooJean";

export interface PlayingMembers {
	artist: readonly Member[];
	albumArtist: readonly Member[];
}

const NOBODY: PlayingMembers = { artist: [], albumArtist: [] };

const RETRY_MS = 1_000;
const RETRIES = 3;

class WorthAskingAgain extends Error {}

async function readCredits(
	origin: string,
	structure: number,
	ordinal: number,
	splitsCredits: boolean,
): Promise<PlayingMembers | null> {
	const read = await fetchLibraryCredits(origin, LIBRARY_ROLES, {
		structure,
		ordinal,
		splitsCredits,
	});
	if (read.ok) return read.credits;
	if (
		read.reason === "notReady" ||
		read.reason === "tooFast" ||
		read.reason === "unreachable"
	)
		throw new WorthAskingAgain(read.reason);
	return null;
}

function useCreditsMoved(origin: string | null) {
	const [moved, setMoved] = useState(0);
	useEffect(() => {
		if (!origin) return;
		let seen = announcedLibraryOf(origin);
		return watchLibrary(origin, {
			exported: () => {},
			answered: () => {},
			announced: (library) => {
				const before = seen;
				seen = library;
				if (
					before &&
					before.structure === library.structure &&
					readColumnMoved(before, library)
				)
					setMoved((count) => count + 1);
			},
		});
	}, [origin]);
	return moved;
}

export function usePlayingMembers(): PlayingMembers {
	const { discovery } = useFooJean();
	const origin = libraryOrigin(discovery);
	const [splitsCredits] = useSplitCredits();
	const { ordinal, structure } = usePlayingLibrary();
	const moved = useCreditsMoved(origin);

	const members = useQuery({
		queryKey: [
			"playingCredits",
			origin,
			structure,
			ordinal,
			splitsCredits,
			moved,
		],
		enabled: origin !== null && ordinal !== null && structure !== null,
		queryFn: () =>
			origin !== null && ordinal !== null && structure !== null
				? readCredits(origin, structure, ordinal, splitsCredits)
				: null,
		staleTime: Infinity,
		retry: (failures, error) =>
			error instanceof WorthAskingAgain && failures < RETRIES,
		retryDelay: RETRY_MS,
		refetchOnWindowFocus: false,
	}).data;

	return members
		? { artist: members.artist, albumArtist: members.albumArtist }
		: NOBODY;
}
