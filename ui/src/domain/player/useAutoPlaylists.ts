import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
	fetchPlaylistAnnotations,
	type PlaylistAnnotation,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePlaylists } from "./usePlayer";

const KEY = "fooJeanPlaylists";

export function usePlaylistAnnotations(): PlaylistAnnotation[] {
	const { discovery } = useFooJean();
	const { origin, token } = discovery;
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

	return data ?? [];
}

export function useAutoPlaylists(): ReadonlySet<string> {
	const annotations = usePlaylistAnnotations();

	return useMemo(() => {
		const ids = new Set<string>();
		for (const entry of annotations)
			if (entry.isAutoPlaylist && entry.beefwebId) ids.add(entry.beefwebId);
		return ids;
	}, [annotations]);
}
