import {
	type QueryKey,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	createPlaylist,
	fetchPlayer,
	fetchPlaylists,
	movePlaylist,
	nextTrack,
	playPause,
	previousTrack,
	removePlaylist,
	renamePlaylist,
	seekBy,
	seekTo,
	setMuted,
	setPlaybackOrder,
	setVolume,
	stop,
	UPDATES_URL,
	volumeDown,
	volumeUp,
} from "@/shared/api/beefweb";
import type {
	ActiveItem,
	Permissions,
	PlayerSnapshot,
	PlayerState,
	PlaylistInfo,
	UpdateMessage,
} from "@/shared/api/types";
import { useCoalescedWrite } from "@/shared/hooks/useCoalescedWrite";
import { clamp } from "@/shared/lib/math";
import { refusal } from "@/shared/lib/refusal";
import { rememberSnapshot, useAudibleSnapshot } from "./audible";
import { beginSeek } from "./listenerStore";
import { positionAt } from "./position";
import {
	dequeuePlaylist,
	holdQueue,
	isQueueStreamHeld,
	QUEUE_KEY,
} from "./queue";

const PLAYER_KEY = ["player"];
export const PLAYLISTS_KEY = ["playlists"];

// What was playing before the gap, with the anchor it arrived on: paired, because
// pairing the held item with a fresh `syncedAt` rewinds the seek bar by the width
// of the gap.
let held: { item: ActiveItem; syncedAt: number } | null = null;

// See API.md for why a skip needs this. Held here, rather than in the screen, so
// the status bar, the media session and `usePlayingFrom` all read through one hold.
const holdThroughGap = (player: PlayerState, syncedAt: number) => {
	if (player.playbackState === "stopped") {
		held = null;
		return { player, syncedAt };
	}

	const item = player.activeItem;
	if (item?.columns?.length) {
		held = { item, syncedAt };
		return { player, syncedAt };
	}

	if (!held) return { player, syncedAt };
	return {
		player: { ...player, activeItem: held.item },
		syncedAt: held.syncedAt,
	};
};

// Player state is pushed rather than fetched, so each snapshot carries its arrival time as the interpolation anchor.
const snapshot = (player: PlayerState): PlayerSnapshot => {
	const next = holdThroughGap(player, performance.now());
	rememberSnapshot(next);
	return next;
};

// Bridges the SSE stream into the query cache. Mount once, at the root; everything downstream reads through an ordinary useQuery.
export function usePlayerStream() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource(UPDATES_URL);

		source.onmessage = (event) => {
			const { player, playlists, playQueue } = JSON.parse(
				event.data,
			) as UpdateMessage;
			if (player) queryClient.setQueryData(PLAYER_KEY, snapshot(player));
			if (playlists) queryClient.setQueryData(PLAYLISTS_KEY, playlists);
			// Dropped mid-mutation: a reorder rebuilds the tail, so the player pushes every intermediate state. See useQueue.
			if (playQueue && !isQueueStreamHeld())
				queryClient.setQueryData(QUEUE_KEY, playQueue);
		};

		// EventSource reconnects on its own and beefweb replays a full snapshot on connect, so a dropped stream needs no resync here.
		return () => source.close();
	}, [queryClient]);
}

export function usePlayer() {
	return useQuery({
		queryKey: PLAYER_KEY,
		queryFn: async () => snapshot(await fetchPlayer()),
		// The stream owns this key. The fetch only covers first paint and reconnect.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
}

// What is audible here, which lags the player while a stream is attached; anything drawing the current track reads this.
// `usePlayer` stays the source for the player's own state and for query status, neither of which is delayed.
export function useAudiblePlayer() {
	return useAudibleSnapshot(usePlayer().data);
}

export function usePlaylists() {
	return useQuery({
		queryKey: PLAYLISTS_KEY,
		queryFn: fetchPlaylists,
		staleTime: Infinity,
		// beefweb's `playlists` event fires when the set of playlists changes and stays silent when their contents do, so every `itemCount` is stale from the first edit onwards.
		refetchOnWindowFocus: true,
	});
}

// What the player will let this client do: a read-only instance gets a read-only Jean rather than buttons that come back 403.
export function usePermissions(): Partial<Permissions> {
	const { data } = usePlayer();
	return data?.player?.permissions ?? {};
}

// Patch the cache, send, put the old value back if the player refuses. `patch` returns the next value for the key, or null to leave it alone.
function useOptimisticWrite<TData, TInput>(
	queryKey: QueryKey,
	mutationFn: (input: TInput) => Promise<unknown>,
	patch: (previous: TData, input: TInput) => TData | null,
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

// Always re-anchors the interpolation: freezing a position without moving `syncedAt` leaves the seek bar carrying on from where the last update put it.
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

const usePlaylistPatch = <TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
	patch: (playlists: PlaylistInfo[], input: TInput) => PlaylistInfo[],
) =>
	useOptimisticWrite<PlaylistInfo[], TInput>(
		PLAYLISTS_KEY,
		mutationFn,
		(previous, input) => renumber(patch(previous, input)),
	);

export function usePlaylistActions() {
	const queryClient = useQueryClient();

	// The one mutation that cannot be optimistic: only the player can say what id the new playlist got.
	const create = useMutation({
		mutationFn: async (title: string) => {
			const playlist = await createPlaylist(title);
			// Refetched rather than invalidated: what follows resolves against this list, and a row that is not in it yet cannot be put into rename mode.
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return playlist;
		},
	});

	return {
		create,

		rename: usePlaylistPatch(
			({ id, title }: { id: string; title: string }) =>
				renamePlaylist(id, title),
			(playlists, { id, title }) =>
				playlists.map((entry) =>
					entry.id === id ? { ...entry, title } : entry,
				),
		),

		// Deleting a playlist the queue points into crashes the player, so the queue is cleared first and the delete abandoned if it will not go.
		remove: usePlaylistPatch(
			async (id: string) => {
				const release = holdQueue();
				try {
					if (!(await dequeuePlaylist(id))) {
						throw refusal(
							"Tracks from this playlist are still in the play queue, and deleting it while they are would stop the player. Clear the queue and try again.",
						);
					}
				} finally {
					release();
					await queryClient.refetchQueries({ queryKey: QUEUE_KEY });
				}
				return removePlaylist(id);
			},
			(playlists, id) => playlists.filter((entry) => entry.id !== id),
		),

		move: usePlaylistPatch(
			({ id, index }: { id: string; index: number }) => movePlaylist(id, index),
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

// foobar2000 allows two playlists with the same name, and the sidebar shows nothing else to tell them apart by.
export function untitledPlaylistName(playlists: PlaylistInfo[]) {
	const base = "New playlist";
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
	if (!item || item.index < 0 || item.playlistId !== playlistId) return null;
	return item;
}

export const usePlayPause = () =>
	usePlayerPatch<void>(playPause, (player, _input, previous) => ({
		playbackState: player.playbackState === "playing" ? "paused" : "playing",
		// Freeze the interpolated position, not the stale one from the last update, or pausing snaps the bar back by however long the track has been running.
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
		// Offset from the interpolated position, not the last pushed one, or a seek lands wherever the track happened to be at the last update.
		const position = clamp(
			positionAt(previous, performance.now()) + offset,
			0,
			item.duration ?? 0,
		);
		beginSeek(position);
		return { activeItem: { ...item, position } };
	});

// The order enum differs between players and versions, so shuffle is found by name rather than by index.
function findShuffleIndex(names: string[]) {
	const lower = names.map((name) => name.toLowerCase());

	return (
		[
			lower.indexOf("shuffle (tracks)"),
			lower.findIndex((name) => name.includes("shuffle")),
			lower.findIndex((name) => name.includes("random")),
		].find((at) => at >= 0) ?? -1
	);
}

// Global player state rather than a property of the playlist on screen, so toggling it must not disturb what is playing.
export function usePlaybackOrder() {
	const { data } = usePlayer();

	const player = data?.player;
	const option = player?.options?.find((entry) => entry.id === "playbackOrder");
	const names = option?.enumNames ?? player?.playbackModes ?? [];
	// beefweb's `options` is an open list carrying both enum and bool entries, so the value is only a number when this really is the enum one.
	const value =
		(typeof option?.value === "number" ? option.value : player?.playbackMode) ??
		0;

	const shuffleIndex = useMemo(() => findShuffleIndex(names), [names]);
	const isShuffle = shuffleIndex >= 0 && value === shuffleIndex;

	// Turning shuffle off restores the previous order, so a repeat setting survives a shuffle detour. Session-scoped: after a reload the best guess is the first.
	const previousOrder = useRef(0);
	if (!isShuffle && value !== previousOrder.current)
		previousOrder.current = value;

	const mutation = usePlayerPatch(setPlaybackOrder, (player, next: number) => ({
		playbackMode: next,
		options: player.options?.map((entry) =>
			entry.id === "playbackOrder" ? { ...entry, value: next } : entry,
		),
	}));

	const { mutate } = mutation;

	const toggleShuffle = useCallback(() => {
		if (shuffleIndex < 0) return;
		mutate(isShuffle ? previousOrder.current : shuffleIndex);
	}, [isShuffle, shuffleIndex, mutate]);

	// Turns shuffle on rather than flipping it: pressing "play this shuffled" twice must not walk back out of the mode it just asked for.
	const enableShuffle = useCallback(() => {
		if (shuffleIndex < 0 || isShuffle) return;
		mutate(shuffleIndex);
	}, [isShuffle, shuffleIndex, mutate]);

	return {
		isShuffle,
		canShuffle: shuffleIndex >= 0,
		orderName: names[value] ?? null,
		toggleShuffle,
		enableShuffle,
	};
}

// How long a value just sent outranks what the player reports: long enough to cover a push already in flight describing an older position of the slider.
const VOLUME_SETTLE_MS = 1000;
const VOLUME_EPSILON = 0.5;

export function useVolume() {
	const { data } = usePlayer();
	const send = useCoalescedWrite(setVolume);
	const mute = usePlayerPatch(setMuted, (player, isMuted: boolean) => ({
		volume: { ...player.volume, isMuted },
	}));
	const nudgeUp = useMutation({ mutationFn: volumeUp });
	const nudgeDown = useMutation({ mutationFn: volumeDown });

	// State rather than a ref, or the control snaps back to the player's last reported value the moment a drag ends.
	// Kept out of the query cache because a cache write re-renders every subscriber of player state, including the virtualised track list, for the whole gesture.
	const [pending, setPending] = useState<number | null>(null);

	const reported = data?.player?.volume ?? null;

	useEffect(() => {
		if (pending === null || !reported) return undefined;

		if (Math.abs(reported.value - pending) < VOLUME_EPSILON) {
			setPending(null);
			return undefined;
		}

		// The player never confirmed, so hand control back rather than show a value that is no longer true.
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

export const useTransport = () => ({
	next: useMutation({ mutationFn: nextTrack }),
	previous: useMutation({ mutationFn: previousTrack }),
	stop: useMutation({ mutationFn: stop }),
});
