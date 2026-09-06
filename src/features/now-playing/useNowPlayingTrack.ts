import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { fetchActiveItemColumns, readTrack } from "@/shared/api/beefweb";
import type { NowPlayingTrack, TrackColumns } from "@/shared/api/types";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

const keyOf = (track: NowPlayingTrack | null) =>
	track?.path
		? ["nowPlaying", track.path, track.subsong]
		: ["nowPlaying", null];

export interface NowPlayingDetails {
	row: TrackColumns;
	path: string;
}

export function useNowPlayingTrack({ enabled = true } = {}) {
	const snapshot = useAudiblePlayer();
	const track = readTrack(snapshot?.player);
	const path = track?.path ?? null;

	const query = useQuery({
		queryKey: keyOf(track),
		enabled: enabled && path !== null,
		queryFn: async (): Promise<NowPlayingDetails | null> => {
			const row = await fetchActiveItemColumns(NOW_PLAYING_EXPRESSIONS);
			if (!row) return null;

			// The endpoint answers with whatever is playing when it is served, so a track that ended in flight would cache
			// the next track's tags under this key.
			const answered = row[NOW_PLAYING_FIELD.path];
			if (answered !== path) return null;

			return { row, path: answered };
		},
		// beefweb pushes nothing when a tag changes, and a write from Jean patches this cache directly.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const queryClient = useQueryClient();
	const setRating = useCallback(
		(raw: string) => {
			queryClient.setQueryData(
				keyOf(track),
				(current: NowPlayingDetails | null | undefined) => {
					if (!current) return current;
					const row = [...current.row];
					row[NOW_PLAYING_FIELD.rating] = raw;
					return { ...current, row };
				},
			);
		},
		[queryClient, track],
	);

	return {
		track,
		details: query.data ?? null,
		isPending: enabled && query.isPending && path !== null,
		setRating,
	};
}
