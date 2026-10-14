import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { usePlaylists } from "@/domain/player/usePlaylists";
import { namedTrack, readValue } from "@/domain/track/fields";
import { type HeldRating, nowPlayingKey } from "@/domain/track/playingRating";
import { orThrow, retryWhenTooFast } from "@/shared/api/client";
import { playingTrack } from "@/shared/api/playerState";
import { fetchPlayingTrack } from "@/shared/api/tracks";
import type {
	ActiveItem,
	PlaylistInfo,
	TrackAddress,
	TrackColumns,
} from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

// Which announcement a key has already been read for is a fact about the key, not about
// whichever mounted instance of this hook notices it first, and several notice it in the
// same render (`App.tsx` through `useNowPlayingRating`, and `NowPlaying.tsx`): a per-instance
// ref would have each of them call `refetch()`, and the default `cancelRefetch: true` a fresh
// song has to keep would make every later call cancel the one just started by the last.
let lastAnnouncedPoll: {
	path: string | null;
	subsong: number;
	title: string | undefined;
	artist: string | undefined;
} | null = null;

export interface NowPlayingDetails extends HeldRating {
	row: TrackColumns;
	path: string;
}

const withColumn = (
	details: NowPlayingDetails,
	field: number,
	raw: string,
): NowPlayingDetails => {
	const row = [...details.row];
	row[field] = raw;
	return { ...details, row };
};

export function setCachedLyrics(
	queryClient: QueryClient,
	path: string,
	subsong: number,
	raw: string,
) {
	queryClient.setQueryData(
		nowPlayingKey(path, subsong),
		(current: NowPlayingDetails | null | undefined) =>
			current ? withColumn(current, NOW_PLAYING_FIELD.lyrics, raw) : current,
	);
}

export function cachedLyrics(
	queryClient: QueryClient,
	path: string,
	subsong: number,
): string {
	const details = queryClient.getQueryData<NowPlayingDetails>(
		nowPlayingKey(path, subsong),
	);
	return readValue(details?.row[NOW_PLAYING_FIELD.lyrics]) ?? "";
}

function positionOfPlaying(
	item: ActiveItem,
	playlists: readonly PlaylistInfo[],
): TrackAddress | null {
	if (!item.playlistGuid || item.index < 0) return null;

	const structure = playlists.find(
		(playlist) => playlist.id === item.playlistGuid,
	)?.structure;

	return structure === undefined
		? null
		: {
				kind: "playlist",
				playlist: item.playlistGuid,
				index: item.index,
				structure,
			};
}

function addressesOfPlaying(
	item: ActiveItem | undefined,
	playlists: readonly PlaylistInfo[],
): TrackAddress[] {
	if (!item) return [];

	const forms: TrackAddress[] = [];
	if (item.libraryPath)
		forms.push({
			kind: "library",
			track: item.libraryPath,
			subsong: item.subsong,
		});

	const position = positionOfPlaying(item, playlists);
	if (position) forms.push(position);

	return forms;
}

export function useNowPlayingTrack({ enabled = true } = {}) {
	const t = useTranslate();
	const snapshot = useAudiblePlayer();
	const { data: playlists = [] } = usePlaylists();
	const track = namedTrack(playingTrack(snapshot?.player), t);
	const nothingPlaying = snapshot !== undefined && track === null;
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;
	const { discovery } = useFooJean();
	const { origin } = discovery;

	const item = snapshot?.player?.activeItem;
	const addresses = addressesOfPlaying(item, playlists);
	const artistTag = item?.columns[0] || null;
	const duration = item && item.duration > 0 ? item.duration : null;

	const ready = enabled && path !== null && Boolean(origin);

	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: nowPlayingKey(path, subsong),
		enabled: ready,
		queryFn: async ({ signal }): Promise<NowPlayingDetails> => {
			if (!origin) throw new Error("foo_jean is not ready");

			const answer = orThrow(
				await fetchPlayingTrack(origin, NOW_PLAYING_EXPRESSIONS, { signal }),
			);
			if (answer.path !== path || answer.subsong !== subsong)
				throw new Error("the playing track answered for another track");

			const holding = queryClient.getQueryData<NowPlayingDetails>(
				nowPlayingKey(path, subsong),
			);
			const answered = answer.columns[NOW_PLAYING_FIELD.rating];

			return {
				row: answer.columns,
				path: answer.path,
				rating: holding ? holding.rating : answered,
				agreedRating: holding ? holding.agreedRating : answered,
			};
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		...retryWhenTooFast({ otherFailures: 1 }),
	});

	useEffect(() => {
		const previous = lastAnnouncedPoll;
		lastAnnouncedPoll = {
			path,
			subsong,
			title: track?.title,
			artist: track?.artist,
		};
		if (!previous) return;
		if (previous.path !== path || previous.subsong !== subsong) return;
		if (previous.title === track?.title && previous.artist === track?.artist)
			return;

		void query.refetch();
	}, [path, subsong, track?.title, track?.artist, query.refetch]);

	const setLyrics = useCallback(
		(raw: string) => {
			if (path !== null) setCachedLyrics(queryClient, path, subsong, raw);
		},
		[queryClient, path, subsong],
	);

	return {
		track,
		nothingPlaying,
		addresses,
		artistTag,
		duration,
		details: query.isError ? null : (query.data ?? null),
		isPending: ready && query.isPending,
		activeItem: item ?? null,
		setLyrics,
	};
}
