import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
	fetchPlaylistAnnotations,
	type PlaylistAnnotation,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePlaylists } from "./usePlayer";

const KEY = "fooJeanPlaylists";

export interface PlaylistAnnotations {
	entries: PlaylistAnnotation[];
	hasSettled: boolean;
	isFetching: boolean;
}

export function usePlaylistAnnotations(): PlaylistAnnotations {
	const { discovery } = useFooJean();
	const { origin, token } = discovery;
	const { data: playlists } = usePlaylists();

	const { data, status, isFetching, refetch } = useQuery({
		queryKey: [KEY, origin, token],
		queryFn: () =>
			origin && token ? fetchPlaylistAnnotations(origin, token) : null,
		enabled: Boolean(origin && token && playlists),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const playlistCount = playlists?.length ?? 0;
	const lastCount = useRef(playlistCount);
	useEffect(() => {
		if (lastCount.current === playlistCount) return;
		lastCount.current = playlistCount;
		if (origin && token && playlists) void refetch();
	}, [playlistCount, origin, token, playlists, refetch]);

	return {
		entries: data ?? [],
		hasSettled: status !== "pending",
		isFetching,
	};
}

export function useAutoPlaylists(): ReadonlySet<string> {
	const { entries } = usePlaylistAnnotations();

	return useMemo(() => {
		const ids = new Set<string>();
		for (const entry of entries)
			if (entry.isAutoPlaylist && entry.beefwebId) ids.add(entry.beefwebId);
		return ids;
	}, [entries]);
}
