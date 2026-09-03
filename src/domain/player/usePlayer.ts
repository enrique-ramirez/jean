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
import { positionAt } from "./position";
import {
	dequeuePlaylist,
	holdQueue,
	isQueueStreamHeld,
	QUEUE_KEY,
} from "./queue";

const PLAYER_KEY = ["player"];
export const PLAYLISTS_KEY = ["playlists"];

// Player state is pushed, not fetched, so it carries the timestamp it arrived
// at. Keeping the two together makes the interpolation anchor atomic.
const snapshot = (player: PlayerState): PlayerSnapshot => {
	const next = { player, syncedAt: performance.now() };
	// The one funnel every pushed snapshot passes through.
	rememberSnapshot(next);
	return next;
};

// Bridges the SSE stream into the query cache. Mount once, at the root;
// everything downstream then reads through an ordinary useQuery.
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
			// Dropped mid-mutation: a reorder rebuilds the tail, so the player passes
			// through every intermediate state and pushes each one. See useQueue.
			if (playQueue && !isQueueStreamHeld())
				queryClient.setQueryData(QUEUE_KEY, playQueue);
		};

		// EventSource reconnects on its own and beefweb replays a full snapshot on
		// connect, so a dropped stream heals with no resync logic here.
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

// What is audible here. **Anything drawing the current track MUST read this** --
// title, artwork, lyrics, the row in a list. Identical to `usePlayer().data`
// whenever nothing is listening; `usePlayer` stays the source for the player's
// own state and for query status, neither of which is delayed.
export function useAudiblePlayer() {
	return useAudibleSnapshot(usePlayer().data);
}

export function usePlaylists() {
	return useQuery({
		queryKey: PLAYLISTS_KEY,
		queryFn: fetchPlaylists,
		staleTime: Infinity,
		// The one thing the stream cannot tell us: `playlists` fires when the set of
		// playlists changes and stays silent when their contents do, so every
		// `itemCount` is stale from the first edit onwards. An unchanged count is an
		// unchanged key, so this costs nothing when nothing changed.
		refetchOnWindowFocus: true,
	});
}

// What the player will let this client do. A read-only instance must get a
// read-only Jean rather than buttons that come back 403.
export function usePermissions(): Partial<Permissions> {
	const { data } = usePlayer();
	return data?.player?.permissions ?? {};
}

// Every write here is optimistic and optimism is all the same shape: patch the
// cache, send, put the old value back if the player refuses.
//
// `patch` returns the next value for the key, or null to leave it alone.
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

// Always re-anchors the interpolation: freezing a position without moving
// `syncedAt` leaves the seek bar carrying on from where the last update put it.
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

// `index` is rewritten on every playlist mutation because it is positional, and
// the player renumbers the whole list when any playlist moves or goes away.
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

	// The one mutation that cannot be optimistic: only the player can say what id
	// the new playlist got, and everything after is addressed by it.
	const create = useMutation({
		mutationFn: async (title: string) => {
			const playlist = await createPlaylist(title);
			// Refetched rather than invalidated. What follows resolves against this
			// list, and a row that is not in it yet cannot be put into rename mode.
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

		// The queue goes first and the delete is abandoned if it will not go --
		// deleting a playlist the queue points into crashes the player. Here rather
		// than in the sidebar: the next caller would not know to repeat it.
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

// foobar allows two playlists with the same name, but the sidebar gives you
// nothing else to tell them apart by. Numbered like a file manager does it.
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

// The track the player is on, only when it belongs to the playlist being viewed.
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
		// Freeze the interpolated position, not the stale one from the last update,
		// or pausing snaps the bar back by however long the track has been running.
		activeItem: {
			...player.activeItem,
			position: positionAt(previous, performance.now()),
		},
	}));

export const useSeek = () =>
	usePlayerPatch(seekTo, (player, position: number) =>
		player.activeItem
			? { activeItem: { ...player.activeItem, position } }
			: null,
	);

export const useSeekBy = () =>
	usePlayerPatch(seekBy, (player, offset: number, previous) => {
		const item = player.activeItem;
		if (!item) return null;
		// Offset from the interpolated position, not the last pushed one, or a seek
		// lands wherever the track happened to be at the last update.
		const position = clamp(
			positionAt(previous, performance.now()) + offset,
			0,
			item.duration ?? 0,
		);
		return { activeItem: { ...item, position } };
	});

// The order enum differs between players and versions, so shuffle is found by
// name. foobar2000 offers several flavours; tracks is the one people mean.
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

// Global player state rather than a property of the playlist on screen, so
// toggling it must not disturb what is playing -- only what comes next.
export function usePlaybackOrder() {
	const { data } = usePlayer();

	const player = data?.player;
	const option = player?.options?.find((entry) => entry.id === "playbackOrder");
	const names = option?.enumNames ?? player?.playbackModes ?? [];
	// `options` is an open list carrying both enum and bool entries, so the
	// enum's index is only a number when this really is the enum one.
	const value =
		(typeof option?.value === "number" ? option.value : player?.playbackMode) ??
		0;

	const shuffleIndex = useMemo(() => findShuffleIndex(names), [names]);
	const isShuffle = shuffleIndex >= 0 && value === shuffleIndex;

	// Turning shuffle off returns the order you had, so a repeat setting survives a
	// shuffle detour. Session-scoped: after a reload the best guess is the first.
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

	// For "play this shuffled", which turns shuffle on rather than flipping it --
	// pressing it twice must not walk back out of the mode it just asked for.
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

// How long a value just sent outranks what the player reports. Long enough to
// cover a push already in flight describing an older position of the slider,
// short enough that turning the knob on the PC shows up promptly.
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

	// State rather than a ref, or the control would snap back to the player's last
	// reported value the moment a drag ended. Kept here rather than in the query
	// cache because a cache write re-renders every subscriber of player state,
	// including the virtualised track list, for the whole gesture.
	const [pending, setPending] = useState<number | null>(null);

	const reported = data?.player?.volume ?? null;

	useEffect(() => {
		if (pending === null || !reported) return undefined;

		if (Math.abs(reported.value - pending) < VOLUME_EPSILON) {
			setPending(null);
			return undefined;
		}

		// The player never confirmed. Hand control back rather than showing a value
		// that is no longer true.
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

	return {
		volume:
			reported && pending !== null ? { ...reported, value: pending } : reported,
		setValue,
		setMuted: mute.mutate,
		up: nudgeUp.mutate,
		down: nudgeDown.mutate,
	};
}

export const useTransport = () => ({
	next: useMutation({ mutationFn: nextTrack }),
	previous: useMutation({ mutationFn: previousTrack }),
	stop: useMutation({ mutationFn: stop }),
});
