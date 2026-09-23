import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

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
	const nothingPlaying = snapshot !== undefined && track === null;
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;
	const { discovery, isChecking } = useFooJean();
	const { origin, token, retryable } = discovery;

	const addresses = addressesOfPlaying(snapshot?.player?.activeItem, playlists);

	const ready = enabled && path !== null && Boolean(origin && token);

	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: keyOf(path, subsong),
		enabled: ready,
		queryFn: async ({ signal }): Promise<NowPlayingDetails> => {
			if (!origin || !token) throw new Error("foo_jean is not ready");

			const answer = await fetchPlayingTrack(
				origin,
				token,
				NOW_PLAYING_EXPRESSIONS,
				{ signal },
			);
			if (answer.path !== path || answer.subsong !== subsong)
				throw new Error("the playing track answered for another track");

			const holding = queryClient.getQueryData<NowPlayingDetails>(
				keyOf(path, subsong),
			);
			const row = [...answer.columns];
			if (holding)
				row[NOW_PLAYING_FIELD.rating] = holding.row[NOW_PLAYING_FIELD.rating];

			return {
				row,
				path: answer.path,
				agreedRating: holding
					? holding.agreedRating
					: answer.columns[NOW_PLAYING_FIELD.rating],
			};
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: (failureCount, error) => failureCount < 1 && error.cause !== 401,
		retryDelay: 0,
	});

	// `errorUpdateCount` is a running total for the query's own key, so it says "has this
	// track already had its one recovery attempt" without a ledger kept beside it: a 401
	// never auto-retries (see `retry` below), so the count reads 1 until this effect's own
	// `refetch` either lands or fails and pushes it to 2.
	const has401ToRecover =
		query.status === "error" &&
		query.error?.cause === 401 &&
		query.errorUpdateCount === 1;

	const wasChecking = useRef(isChecking);
	useEffect(() => {
		const justSettled = wasChecking.current && !isChecking;
		wasChecking.current = isChecking;
		if (!justSettled || !origin || !token || !has401ToRecover) return;

		// Multiple mounted instances of this hook settle onto the same query key at once,
		// so `cancelRefetch: false` is what keeps a second call from cancelling the first
		// attempt and restarting it, rather than sharing it.
		void query.refetch({ cancelRefetch: false });
	}, [isChecking, origin, token, has401ToRecover, query.refetch]);

	// The gap between the 401 settling and the recovery `refetch` above landing is exactly
	// the recheck, and pairing is only given up on once it settles without coming back:
	// `retryable` is what tells a recheck still due another attempt of its own apart from one
	// that is not coming back at all.
	const givenUp = !isChecking && !(origin && token) && !retryable;
	const awaitingRecovery = has401ToRecover && !givenUp;

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
		nothingPlaying,
		addresses,
		details: query.isError ? null : (query.data ?? null),
		isPending: (ready && query.isPending) || awaitingRecovery,
		setRating,
		confirmRating,
		restoreRating,
		setLyrics,
	};
}
