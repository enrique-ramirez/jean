import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchPlaylistAnnotations } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePlaylists } from "./usePlayer";

const KEY = "fooJeanPlaylists";

// Absent, unreachable or unpaired this is an empty set and every playlist looks ordinary, so nothing
// may treat "not an autoplaylist" as a fact rather than as the absence of one. It only ever removes
// an affordance.
export function useAutoPlaylists(): ReadonlySet<string> {
	const { discovery } = useFooJean();
	const { origin, token } = discovery;
	// The join is on `beefwebId`, which beefweb assigns lazily, so this waits on the playlists query
	// rather than racing it.
	const { data: playlists } = usePlaylists();

	const { data } = useQuery({
		queryKey: [KEY, origin, token, playlists?.length ?? 0],
		queryFn: () =>
			origin && token ? fetchPlaylistAnnotations(origin, token) : null,
		enabled: Boolean(origin && token && playlists),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	return useMemo(() => {
		const ids = new Set<string>();
		for (const entry of data ?? [])
			if (entry.isAutoPlaylist && entry.beefwebId) ids.add(entry.beefwebId);
		return ids;
	}, [data]);
}
