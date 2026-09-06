import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchPlaylistAnnotations } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePlaylists } from "./usePlayer";

const KEY = "fooJeanPlaylists";

/**
 * Which of the player's playlists are autoplaylists.
 *
 * beefweb cannot say: `PlaylistInfo` has six fields and none of them is this, and every way of
 * working it out from the outside is worse than not knowing -- probing with a write is destructive,
 * `itemCount` drift cannot separate a smart playlist from `Default Playlist` churn, and a name
 * heuristic only catches foobar2000's own `#Quicksearch` prefix. `foo_jean` answers it directly.
 *
 * Absent, unreachable or unpaired, this is an empty set and every playlist looks ordinary -- which is
 * exactly what Jean did before, so nothing may treat "not an autoplaylist" as a fact rather than as
 * the absence of one. It only ever *removes* an affordance.
 */
export function useAutoPlaylists(): ReadonlySet<string> {
	const { discovery } = useFooJean();
	const { origin, token } = discovery;
	// The join is on `beefwebId`, and beefweb assigns those lazily -- a playlist created a moment ago
	// reports `null` until beefweb next rebuilds its map, and asking beefweb is what makes it. So this
	// waits on the playlists query rather than racing it.
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
