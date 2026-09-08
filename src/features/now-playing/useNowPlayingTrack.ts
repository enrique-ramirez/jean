import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { fetchActiveItemColumns, readTrack } from "@/shared/api/beefweb";
import type { TrackColumns } from "@/shared/api/types";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

// Keyed on the file rather than the playlist position, which moves whenever anything above it is edited.
// The parameters are primitives because `readTrack` builds a fresh object every render, so a callback
// keyed on the track itself would be rebuilt every render and could never be depended on from an effect.
const keyOf = (path: string | null, subsong: number) =>
	path ? ["nowPlaying", path, subsong] : ["nowPlaying", null];

export interface NowPlayingDetails {
	row: TrackColumns;
	path: string;
}

export function useNowPlayingTrack({ enabled = true } = {}) {
	const snapshot = useAudiblePlayer();
	const track = readTrack(snapshot?.player);
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;

	const query = useQuery({
		queryKey: keyOf(path, subsong),
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
	const patch = useCallback(
		(field: number, raw: string) => {
			queryClient.setQueryData(
				keyOf(path, subsong),
				(current: NowPlayingDetails | null | undefined) => {
					if (!current) return current;
					const row = [...current.row];
					row[field] = raw;
					return { ...current, row };
				},
			);
		},
		[queryClient, path, subsong],
	);

	const setRating = useCallback(
		(raw: string) => patch(NOW_PLAYING_FIELD.rating, raw),
		[patch],
	);

	const setLyrics = useCallback(
		(raw: string) => patch(NOW_PLAYING_FIELD.lyrics, raw),
		[patch],
	);

	return {
		track,
		details: query.data ?? null,
		isPending: enabled && query.isPending && path !== null,
		setRating,
		setLyrics,
	};
}
