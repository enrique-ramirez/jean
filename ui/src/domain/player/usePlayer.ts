import {
	type QueryClient,
	type QueryKey,
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	nextTrack,
	playPause,
	previousTrack,
	seekBy,
	seekTo,
	setMuted,
	setPlaybackOrder,
	setVolume,
	stop,
	volumeDown,
	volumeUp,
} from "@/shared/api/beefweb";
import {
	createPlaylist,
	fetchPlaylistAnnotations,
	movePlaylist,
	type PlaylistAnnotation,
	playPlaylistItem,
	removePlaylist,
	renamePlaylist,
	requireFooJean,
} from "@/shared/api/fooJean";
import type {
	ActiveItem,
	PlaybackMode,
	PlayerSnapshot,
	PlayerState,
	PlaylistInfo,
} from "@/shared/api/types";
import { useCoalescedWrite } from "@/shared/hooks/useCoalescedWrite";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
import { clamp } from "@/shared/lib/math";
import { useAudibleSnapshot } from "./audible";
import { beginSeek } from "./listenerStore";
import { PLAYER_KEY, pollPlayerNow, VOLUME_SETTLE_MS } from "./playerPoll";
import { audibleAt, positionAt } from "./position";

export const PLAYLISTS_KEY = ["playlists"];

// PlaylistAnnotation-shaped placeholders: neither field is answered by the component and nothing
// under `src/` reads either any more, but `PlaylistInfo` is a wider contract than this bundle owns.
const NOT_TRACKED = { isCurrent: false, totalTime: 0 };

// A generation is always a non-empty run of digits, so an empty string is a value the component
// can never answer and is safe to hold until the create response replaces it.
const UNKNOWN_GENERATION = "";

export const playlistInfoOf = (
	annotation: PlaylistAnnotation,
): PlaylistInfo => ({
	id: annotation.id,
	index: annotation.index,
	title: annotation.title,
	itemCount: annotation.itemCount,
	structure: annotation.structure,
	revision: annotation.revision,
	role: annotation.role,
	isAutoPlaylist: annotation.isAutoPlaylist,
	...NOT_TRACKED,
});

export function usePlayer() {
	return useQuery<PlayerSnapshot>({
		queryKey: PLAYER_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
}

export function useAudiblePlayer() {
	return useAudibleSnapshot(usePlayer().data);
}

export function usePlaylists() {
	return useQuery<PlaylistInfo[]>({
		queryKey: PLAYLISTS_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
}

const PLAYLISTS_REVISION_KEY = ["playlistsRevision"];
const PLAYLISTS_SEEN_REVISION_KEY = ["playlistsSeenRevision"];

// `GET /playlists` carries no revision of its own, so the one from `GET /state`'s `player` is kept
// beside the list to compare against: re-read only when it has moved, exactly as the queue does.
// The seen revision is recorded before the refetch settles, so a reader comparing the two keys can
// tell "the list has not been asked to catch up yet" from "it has been asked and has not yet".
export async function recheckPlaylists(
	client: QueryClient,
	origin: string,
	token: string,
	revision: number,
): Promise<void> {
	client.setQueryData(PLAYLISTS_SEEN_REVISION_KEY, revision);
	if (client.getQueryData<number>(PLAYLISTS_REVISION_KEY) === revision) return;

	const annotations = await fetchPlaylistAnnotations(origin, token);
	if (!annotations) return;

	client.setQueryData(PLAYLISTS_KEY, annotations.map(playlistInfoOf));
	client.setQueryData(PLAYLISTS_REVISION_KEY, revision);
}

// Whether the list has caught up with the revision the poll last announced, a property of the list
// rather than of any one reader: "has ever fetched" stops answering that the moment a stale fetch
// lands, which is why this compares the two revisions instead of reading a query's own status.
export function usePlaylistsCaughtUp(): boolean {
	const { data: seen } = useQuery<number>({
		queryKey: PLAYLISTS_SEEN_REVISION_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
	const { data: fetchedAt } = useQuery<number>({
		queryKey: PLAYLISTS_REVISION_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
	return seen !== undefined && seen === fetchedAt;
}

export function resolvedPlaylistId(
	guid: string | null,
	playlists: readonly PlaylistInfo[],
	caughtUp: boolean,
): string | null | undefined {
	if (!guid) return null;
	if (playlists.some((playlist) => playlist.id === guid)) return guid;
	return caughtUp ? null : undefined;
}

export function useResolvedPlaylistId(
	guid: string | null,
): string | null | undefined {
	const { data: playlists = [] } = usePlaylists();
	const caughtUp = usePlaylistsCaughtUp();

	return useMemo(
		() => resolvedPlaylistId(guid, playlists, caughtUp),
		[guid, playlists, caughtUp],
	);
}

function useOptimisticWrite<TData, TInput, TResult = unknown>(
	queryKey: QueryKey,
	mutationFn: (input: TInput) => Promise<TResult>,
	patch: (previous: TData, input: TInput) => TData | null,
	reconcile?: (previous: TData, input: TInput, result: TResult) => TData | null,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn,

		onMutate: async (input: TInput) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<TData>(queryKey);
			const next = previous ? patch(previous, input) : null;
			if (next) queryClient.setQueryData(queryKey, next);
			return { previous };
		},

		onSuccess: reconcile
			? (result: TResult, input: TInput) => {
					const current = queryClient.getQueryData<TData>(queryKey);
					const next = current ? reconcile(current, input, result) : null;
					if (next) queryClient.setQueryData(queryKey, next);
				}
			: undefined,

		onError: (
			_error: unknown,
			_input: TInput,
			context: { previous?: TData } | undefined,
		) => {
			if (context?.previous)
				queryClient.setQueryData(queryKey, context.previous);
		},
	});
}

// Always re-anchors the interpolation: freezing a position without moving `syncedAt` leaves the seek
// bar carrying on from where the last update put it.
const usePlayerPatch = <TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
	patchPlayer: (
		player: PlayerState,
		input: TInput,
		previous: PlayerSnapshot,
	) => Partial<PlayerState> | null,
) =>
	useOptimisticWrite<PlayerSnapshot, TInput>(
		PLAYER_KEY,
		mutationFn,
		(previous, input) => {
			const player = previous.player;
			if (!player) return null;
			const next = patchPlayer(player, input, previous);
			return (
				next && { player: { ...player, ...next }, syncedAt: performance.now() }
			);
		},
	);

// `index` is positional, and the player renumbers the whole list when any playlist moves or goes away.
const renumber = (playlists: PlaylistInfo[]) =>
	playlists.map((entry, index) => ({ ...entry, index }));

const usePlaylistPatch = <TInput, TResult = unknown>(
	mutationFn: (input: TInput) => Promise<TResult>,
	patch: (playlists: PlaylistInfo[], input: TInput) => PlaylistInfo[],
	reconcile?: (
		playlists: PlaylistInfo[],
		input: TInput,
		result: TResult,
	) => PlaylistInfo[],
) =>
	useOptimisticWrite<PlaylistInfo[], TInput, TResult>(
		PLAYLISTS_KEY,
		mutationFn,
		(previous, input) => renumber(patch(previous, input)),
		reconcile &&
			((previous, input, result) =>
				renumber(reconcile(previous, input, result))),
	);

export function usePlaylistActions() {
	const { discovery } = useFooJean();

	const create = usePlaylistPatch<{ id: string; title: string }, PlaylistInfo>(
		async ({ title }) => {
			const { origin, token } = requireFooJean(
				discovery.origin,
				discovery.token,
			);
			return playlistInfoOf(await createPlaylist(origin, token, { title }));
		},
		(playlists, { id, title }) => [
			...playlists,
			{
				id,
				title,
				itemCount: 0,
				structure: UNKNOWN_GENERATION,
				revision: UNKNOWN_GENERATION,
				index: playlists.length,
				role: null,
				isAutoPlaylist: false,
				...NOT_TRACKED,
			},
		],
		(playlists, { id }, created) =>
			playlists.map((entry) => (entry.id === id ? created : entry)),
	);

	return {
		create,

		rename: usePlaylistPatch(
			({ id, title }: { id: string; title: string }) => {
				const { origin, token } = requireFooJean(
					discovery.origin,
					discovery.token,
				);
				return renamePlaylist(origin, token, id, title);
			},
			(playlists, { id, title }) =>
				playlists.map((entry) =>
					entry.id === id ? { ...entry, title } : entry,
				),
		),

		remove: usePlaylistPatch(
			(id: string) => {
				const { origin, token } = requireFooJean(
					discovery.origin,
					discovery.token,
				);
				return removePlaylist(origin, token, id);
			},
			(playlists, id) => playlists.filter((entry) => entry.id !== id),
		),

		move: usePlaylistPatch(
			({ id, index }: { id: string; index: number }) => {
				const { origin, token } = requireFooJean(
					discovery.origin,
					discovery.token,
				);
				return movePlaylist(origin, token, id, index);
			},
			(playlists, { id, index }) => {
				const from = playlists.findIndex((entry) => entry.id === id);
				if (from < 0) return playlists;
				const without = playlists.filter((entry) => entry.id !== id);
				return [
					...without.slice(0, index),
					playlists[from],
					...without.slice(index),
				];
			},
		),
	};
}

// foobar2000 allows two playlists with the same name, and the sidebar shows nothing else to tell
// them apart by.
export function untitledPlaylistName(playlists: PlaylistInfo[]) {
	const base = translate("playlist.newName");
	const taken = new Set(playlists.map((entry) => entry.title));

	return (
		[
			base,
			...Array.from(
				{ length: playlists.length + 1 },
				(_, at) => `${base} ${at + 2}`,
			),
		].find((name) => !taken.has(name)) ?? base
	);
}

export function useIsPlaying() {
	const { data } = usePlayer();
	return data?.player?.playbackState === "playing";
}

export function useActiveItem(
	playlistId: string | null | undefined,
): ActiveItem | null {
	const { data } = usePlayer();
	const item = data?.player?.activeItem;
	const playingId = useResolvedPlaylistId(item?.playlistGuid ?? null);
	if (!item || item.index < 0 || playingId !== playlistId) return null;
	return item;
}

// The poll can lag a bare `playItem` post by up to `POLL_MS`, and `usePlaySet.ts` and
// `PlaylistView.tsx` both need the flip to "playing" to be visible at once.
export const usePlayItem = () => {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();

	return usePlayerPatch(
		async ({ playlistId, index }: { playlistId: string; index: number }) => {
			const { origin, token } = requireFooJean(
				discovery.origin,
				discovery.token,
			);
			await playPlaylistItem(origin, token, playlistId, index);
			await pollPlayerNow(queryClient, origin, token);
		},
		() => ({ playbackState: "playing" }),
	);
};

export const usePlayPause = () =>
	usePlayerPatch<void>(playPause, (player, _input, previous) => ({
		playbackState: player.playbackState === "playing" ? "paused" : "playing",
		// The interpolated position, not the stale one from the last update, or pausing snaps the bar
		// back by however long the track has been running.
		activeItem: {
			...player.activeItem,
			position: positionAt(previous, performance.now()),
		},
	}));

export const useSeek = () =>
	usePlayerPatch(seekTo, (player, position: number) => {
		if (!player.activeItem) return null;
		beginSeek(position);
		return { activeItem: { ...player.activeItem, position } };
	});

export const useSeekBy = () =>
	usePlayerPatch(seekBy, (player, offset: number, previous) => {
		const item = player.activeItem;
		if (!item) return null;
		const position = clamp(
			positionAt(previous, performance.now()) + offset,
			0,
			item.duration ?? 0,
		);
		beginSeek(position);
		return { activeItem: { ...item, position } };
	});

// `foo_jean`'s own vocabulary, in the fixed order that matches foobar2000's stock `playbackOrder`
// enum. `usePlaybackOrder` reads it both ways: a mode's index is the ordinal `setPlaybackOrder`
// sends beefweb, and the ordinal it echoes back indexes into this array for the optimistic patch.
const JEAN_ORDER: PlaybackMode[] = [
	"inOrder",
	"repeatAll",
	"repeatOne",
	"random",
	"shuffleTracks",
	"shuffleAlbums",
	"shuffleFolders",
];

const SHUFFLE_PRIORITY: PlaybackMode[] = [
	"shuffleTracks",
	"shuffleAlbums",
	"shuffleFolders",
	"random",
];

type OrderPhrase = Extract<Phrase, `player.order.${string}`>;

const ORDER_NAME_PHRASE: Record<PlaybackMode, OrderPhrase> = {
	inOrder: "player.order.inOrder",
	repeatAll: "player.order.repeatAll",
	repeatOne: "player.order.repeatOne",
	random: "player.order.random",
	shuffleTracks: "player.order.shuffleTracks",
	shuffleAlbums: "player.order.shuffleAlbums",
	shuffleFolders: "player.order.shuffleFolders",
};

const findShuffleMode = (offered: PlaybackMode[]) =>
	SHUFFLE_PRIORITY.find((mode) => offered.includes(mode)) ?? null;

export function usePlaybackOrder() {
	const { data } = usePlayer();
	const { discovery } = useFooJean();

	const player = data?.player;

	const capabilities =
		discovery.state.kind === "ready" ? discovery.state.capabilities : null;

	const mode = player?.jeanPlaybackMode ?? null;
	const modeOrdinal = mode !== null ? JEAN_ORDER.indexOf(mode) : -1;
	const value = modeOrdinal >= 0 ? modeOrdinal : 0;

	const offeredModes = capabilities?.playbackModes ?? [];
	const shuffleMode = useMemo(
		() => findShuffleMode(offeredModes),
		[offeredModes],
	);
	const isShuffle = shuffleMode !== null && mode === shuffleMode;

	const isInOrder = mode === "inOrder";

	const previousOrder = useRef(0);
	if (!isShuffle && value !== previousOrder.current)
		previousOrder.current = value;

	const mutation = usePlayerPatch(setPlaybackOrder, (player, next: number) => ({
		jeanPlaybackMode: JEAN_ORDER[next] ?? player.jeanPlaybackMode,
	}));

	const { mutate } = mutation;

	const toggleShuffle = useCallback(() => {
		if (shuffleMode === null) return;
		mutate(isShuffle ? previousOrder.current : JEAN_ORDER.indexOf(shuffleMode));
	}, [isShuffle, shuffleMode, mutate]);

	const enableShuffle = useCallback(() => {
		if (shuffleMode === null || isShuffle) return;
		mutate(JEAN_ORDER.indexOf(shuffleMode));
	}, [isShuffle, shuffleMode, mutate]);

	return {
		isShuffle,
		canShuffle: shuffleMode !== null,
		orderName: mode ? translate(ORDER_NAME_PHRASE[mode]) : null,
		isInOrder,
		toggleShuffle,
		enableShuffle,
	};
}

const VOLUME_EPSILON = 0.5;

export function useVolume() {
	const { data } = usePlayer();
	const send = useCoalescedWrite(setVolume);
	const mute = usePlayerPatch(setMuted, (player, isMuted: boolean) => ({
		volume: { ...player.volume, isMuted },
	}));
	const nudgeUp = useMutation({ mutationFn: volumeUp });
	const nudgeDown = useMutation({ mutationFn: volumeDown });

	// State rather than a ref, or the control snaps back to the player's last reported value the
	// moment a drag ends. Out of the query cache, whose writes re-render every subscriber of player
	// state for the whole gesture.
	const [pending, setPending] = useState<number | null>(null);

	const reported = data?.player?.volume ?? null;

	useEffect(() => {
		if (pending === null || !reported) return undefined;

		if (Math.abs(reported.value - pending) < VOLUME_EPSILON) {
			setPending(null);
			return undefined;
		}

		const timer = setTimeout(() => setPending(null), VOLUME_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [pending, reported]);

	const setValue = useCallback(
		(value: number) => {
			setPending(value);
			send(value);
		},
		[send],
	);

	const askedMuted = useRef<boolean | null>(null);
	const reportedMuted = reported?.isMuted ?? false;

	if (askedMuted.current === reportedMuted) askedMuted.current = null;

	const toggleMuted = useCallback(() => {
		const next = !(askedMuted.current ?? reportedMuted);
		askedMuted.current = next;
		mute.mutate(next);
	}, [mute.mutate, reportedMuted]);

	return {
		volume:
			reported && pending !== null ? { ...reported, value: pending } : reported,
		setValue,
		toggleMuted,
		up: nudgeUp.mutate,
		down: nudgeDown.mutate,
	};
}

const RESTART_AFTER_SECONDS = 5;

export function usePrevious() {
	const queryClient = useQueryClient();
	const seek = useSeek().mutate;
	const skip = useMutation({ mutationFn: previousTrack }).mutate;

	return useCallback(
		(stepBack: () => void = () => skip()) => {
			const snapshot = queryClient.getQueryData<PlayerSnapshot>(PLAYER_KEY);
			if (audibleAt(snapshot) > RESTART_AFTER_SECONDS) seek(0);
			else stepBack();
		},
		[queryClient, seek, skip],
	);
}

export const useTransport = () => ({
	next: useMutation({ mutationFn: nextTrack }),
	previous: useMutation({ mutationFn: previousTrack }),
	stop: useMutation({ mutationFn: stop }),
});
