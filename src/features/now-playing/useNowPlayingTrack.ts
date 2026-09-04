import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { fetchActiveItemColumns, readTrack } from "@/shared/api/beefweb";
import type { NowPlayingTrack, TrackColumns } from "@/shared/api/types";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

// Keyed on the file rather than on its playlist index, which moves the moment anything above it is edited.
const keyOf = (track: NowPlayingTrack | null) =>
	track?.path
		? ["nowPlaying", track.path, track.subsong]
		: ["nowPlaying", null];

export interface NowPlayingDetails {
	row: TrackColumns;
	/** What the player says the file is, from the same read, so a caller can tell an absent value from an unasked one. */
	path: string;
}

/**
 * The playing track's lyric tag and detail fields: one request per track change, never off the update stream, which re-evaluates its expressions on every push.
 *
 * `enabled` is for a caller that wants the values only some of the time, and costs nothing where another caller is already asking: the two share one query.
 */
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

			// The endpoint answers with whatever is playing when it is served, so a track that ended in flight would cache the next track's lyrics under this key.
			const answered = row[NOW_PLAYING_FIELD.path];
			if (answered !== path) return null;

			return { row, path: answered };
		},
		// Nothing pushes tag changes, and a write from Jean patches this cache directly.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		// A track that ended mid-request answers null, and the next track's own query is already on its way.
		retry: false,
	});

	// beefweb pushes nothing when a tag changes, so the optimistic value is the only value until this key is evicted.
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
