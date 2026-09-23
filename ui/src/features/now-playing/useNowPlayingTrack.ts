import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAudiblePlayer, usePlaylists } from "@/domain/player/usePlayer";
import { fetchPlayingTrack } from "@/shared/api/fooJean";
import { readTrack } from "@/shared/api/playerState";
import type {
	ActiveItem,
	PlaylistInfo,
	TrackAddress,
	TrackColumns,
} from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { NOW_PLAYING_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";

const keyOf = (path: string | null, subsong: number) =>
	path ? ["nowPlaying", path, subsong] : ["nowPlaying", null];

export interface NowPlayingDetails {
	row: TrackColumns;
	path: string;
	agreedRating: string;
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
	const snapshot = useAudiblePlayer();
	const { data: playlists = [] } = usePlaylists();
	const track = readTrack(snapshot?.player);
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;
	const { discovery } = useFooJean();
	const { origin, token } = discovery;

	const addresses = addressesOfPlaying(snapshot?.player?.activeItem, playlists);

	const ready = enabled && path !== null && Boolean(origin && token);

	const query = useQuery({
		queryKey: keyOf(path, subsong),
		enabled: ready,
		queryFn: async (): Promise<NowPlayingDetails> => {
			if (!origin || !token) throw new Error("foo_jean is not ready");

			const answer = await fetchPlayingTrack(
				origin,
				token,
				NOW_PLAYING_EXPRESSIONS,
			);
			if (answer.path !== path || answer.subsong !== subsong)
				throw new Error("the playing track answered for another track");

			return {
				row: answer.columns,
				path: answer.path,
				agreedRating: answer.columns[NOW_PLAYING_FIELD.rating],
			};
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const queryClient = useQueryClient();
	const patch = useCallback(
		(change: (current: NowPlayingDetails) => NowPlayingDetails) => {
			queryClient.setQueryData(
				keyOf(path, subsong),
				(current: NowPlayingDetails | null | undefined) =>
					current ? change(current) : current,
			);
		},
		[queryClient, path, subsong],
	);

	const setRating = useCallback(
		(raw: string) =>
			patch((current) => withColumn(current, NOW_PLAYING_FIELD.rating, raw)),
		[patch],
	);

	const confirmRating = useCallback(
		(raw: string) =>
			patch((current) => ({
				...withColumn(current, NOW_PLAYING_FIELD.rating, raw),
				agreedRating: raw,
			})),
		[patch],
	);

	const restoreRating = useCallback(
		() =>
			patch((current) =>
				withColumn(current, NOW_PLAYING_FIELD.rating, current.agreedRating),
			),
		[patch],
	);

	const setLyrics = useCallback(
		(raw: string) =>
			patch((current) => withColumn(current, NOW_PLAYING_FIELD.lyrics, raw)),
		[patch],
	);

	return {
		track,
		addresses,
		details: query.data ?? null,
		isPending: ready && query.isPending,
		setRating,
		confirmRating,
		restoreRating,
		setLyrics,
	};
}
