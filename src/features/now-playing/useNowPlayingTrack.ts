import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { fetchActiveItemColumns, readTrack } from "@/shared/api/beefweb";
import type { NowPlayingTrack, TrackColumns } from "@/shared/api/types";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

// Keyed on what the file *is* rather than on where it sits. A playlist index
// moves the moment anything above it is edited -- from Jean or from the desktop
// -- and re-fetching two dozen fields because a row was deleted somewhere else
// is work for nothing. The same file playing twice is the same answer, so a
// cache hit there is correct rather than lucky.
const keyOf = (track: NowPlayingTrack | null) =>
	track?.path
		? ["nowPlaying", track.path, track.subsong]
		: ["nowPlaying", null];

export interface NowPlayingDetails {
	row: TrackColumns;
	// What the player says the file is, straight from the same read. Held so a
	// caller can tell a value that is genuinely absent from one it has not been
	// asked for yet.
	path: string;
}

// The playing track's lyric tag and detail fields: one request, on track change,
// and deliberately not off the update stream, which re-evaluates its expressions
// on every push. See "The one request" in this folder's CLAUDE.md.
export function useNowPlayingTrack() {
	const snapshot = useAudiblePlayer();
	const track = readTrack(snapshot?.player);
	const path = track?.path ?? null;

	const query = useQuery({
		queryKey: keyOf(track),
		enabled: path !== null,
		queryFn: async (): Promise<NowPlayingDetails | null> => {
			const row = await fetchActiveItemColumns(NOW_PLAYING_EXPRESSIONS);
			if (!row) return null;

			// Verified, not trusted, for the same reason `LibrarySource.identify`
			// verifies: this endpoint answers with whatever is playing at the moment
			// it is served, and a track that ended while the request was in flight
			// would otherwise cache the *next* track's lyrics under this one's key.
			const answered = row[NOW_PLAYING_FIELD.path];
			if (answered !== path) return null;

			return { row, path: answered };
		},
		// Tags do not change under Jean's feet -- and when Jean itself writes one,
		// it patches this cache directly. Nothing pushes tag changes, so there is
		// no update to wait for and nothing to reconcile against.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		// A track that ended mid-request answers null; the next track's own query
		// is already on its way, so retrying this one races it for nothing.
		retry: false,
	});

	// Rating is the one field Jean writes, and beefweb pushes nothing when a tag
	// changes -- so the optimistic value is the only value until this key is
	// evicted. Patching the row in place keeps that fact in one store rather than
	// adding a second overlay beside `ratingStore`, which is keyed on the row
	// arrays `playlistStore` publishes and cannot see this one.
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
		isPending: query.isPending && path !== null,
		setRating,
	};
}
