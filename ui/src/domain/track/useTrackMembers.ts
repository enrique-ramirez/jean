import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Member } from "@/domain/artist/credits";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import { libraryOrigin } from "@/shared/api/discovery";
import {
	type CreditsAddress,
	fetchLibraryCredits,
} from "@/shared/api/libraryCredits";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { LIBRARY_ROLES, readColumnMoved } from "./libraryAsker";
import { announcedLibraryOf, watchLibrary } from "./libraryHolds";

export interface TrackMembers {
	artist: readonly Member[];
	albumArtist: readonly Member[];
}

const NOBODY: TrackMembers = { artist: [], albumArtist: [] };

const RETRY_MS = 1_000;
const RETRIES = 3;

class WorthAskingAgain extends Error {}

async function readCredits(
	origin: string,
	address: CreditsAddress,
	splitsCredits: boolean,
): Promise<TrackMembers | null> {
	const read = await fetchLibraryCredits(origin, LIBRARY_ROLES, {
		...address,
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

// The members a track's artist and album artist credits name, empty until read and wherever the
// player cannot say (no such track, a path two roots hold, no snapshot yet): a caller falls back to
// the credit's text. A null address asks nothing.
export function useTrackMembers(address: CreditsAddress | null): TrackMembers {
	const { discovery } = useFooJean();
	const origin = libraryOrigin(discovery);
	const [splitsCredits] = useSplitCredits();
	const moved = useCreditsMoved(origin);

	const named =
		address === null
			? null
			: "track" in address
				? (["path", address.track, address.subsong] as const)
				: (["ordinal", address.structure, address.ordinal] as const);

	const members = useQuery({
		queryKey: ["trackCredits", origin, named, splitsCredits, moved],
		enabled: origin !== null && address !== null,
		queryFn: () =>
			origin !== null && address !== null
				? readCredits(origin, address, splitsCredits)
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
