import {
	type QueryKey,
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	createPlaylist,
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
	PlaybackMode,
	PlayerSnapshot,
	PlayerState,
	PlaylistInfo,
	UpdateMessage,
} from "@/shared/api/types";
import { useCoalescedWrite } from "@/shared/hooks/useCoalescedWrite";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
import { clamp } from "@/shared/lib/math";
import { refusal } from "@/shared/lib/refusal";
import { rememberSnapshot, useAudibleSnapshot } from "./audible";
import { beginSeek } from "./listenerStore";
import { keepPollOwned, PLAYER_KEY, VOLUME_SETTLE_MS } from "./playerPoll";
import { positionAt } from "./position";
import {
	dequeuePlaylist,
	holdQueue,
	isQueueStreamHeld,
	QUEUE_KEY,
} from "./queue";

export const PLAYLISTS_KEY = ["playlists"];

let held: { item: ActiveItem; syncedAt: number } | null = null;

// foobar2000 empties `activeItem` for as long as a skip takes to open the next file. See
// ../../shared/api/README.md, "the gap a skip leaves".
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

const snapshot = (player: PlayerState): PlayerSnapshot => {
	const next = holdThroughGap(player, performance.now());
	rememberSnapshot(next);
	return next;
};

export function usePlayerStream() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource(UPDATES_URL);

		source.onmessage = (event) => {
			const { player, playlists, playQueue } = JSON.parse(
				event.data,
			) as UpdateMessage;
			if (player) {
				const previous = queryClient.getQueryData<PlayerSnapshot>(PLAYER_KEY);
				queryClient.setQueryData(
					PLAYER_KEY,
					snapshot(keepPollOwned(previous?.player, player)),
				);
			}
			if (playlists) queryClient.setQueryData(PLAYLISTS_KEY, playlists);
			if (playQueue && !isQueueStreamHeld())
				queryClient.setQueryData(QUEUE_KEY, playQueue);
		};

		return () => source.close();
	}, [queryClient]);
}

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
	return useQuery({
		queryKey: PLAYLISTS_KEY,
		queryFn: fetchPlaylists,
		staleTime: Infinity,
		refetchOnWindowFocus: true,
	});
}

export function usePermissions(): Partial<Permissions> {
	const { data } = usePlayer();
	return data?.player?.permissions ?? {};
}

export const canChangePlaylists = (permissions: Partial<Permissions>) =>
	permissions.changePlaylists !== false;

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

	const create = useMutation({
		mutationFn: async (title: string) => {
			const playlist = await createPlaylist(title);
			// Refetched rather than invalidated: what follows resolves against this list, and a row not
			// in it yet cannot be put into rename mode.
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

		remove: usePlaylistPatch(
			async (id: string) => {
				const release = holdQueue();
				try {
					if (!(await dequeuePlaylist(id))) {
						throw refusal(translate("playlist.deleteBlockedByQueue"));
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
	if (!item || item.index < 0 || item.playlistId !== playlistId) return null;
	return item;
}

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
// enum. The deprecated numeric write still needs an ordinal to send beefweb, and this correspondence
// is the only one left once the live enum stopped riding the wire.
const JEAN_ORDER: PlaybackMode[] = [
	"inOrder",
	"repeatAll",
	"repeatOne",
	"random",
	"shuffleTracks",
	"shuffleAlbums",
	"shuffleFolders",
];

// The mode the switch enters, preferring a per-track shuffle where an install names more than one and
// falling back to `random` for an install with no dedicated shuffle order at all.
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
	const option = player?.options?.find((entry) => entry.id === "playbackOrder");

	// `foo_jean` pairs with foobar2000 alone, so its presence is what `player.info.name` would
	// otherwise say: the order rides back as the `options` entry foobar2000 wants, and DeaDBeeF's
	// only other player takes the deprecated top-level field instead.
	const capabilities =
		discovery.state.kind === "ready" ? discovery.state.capabilities : null;

	// `foo_jean`'s own name for the order the player is in right now, or `null` where there is no
	// `foo_jean` to ask or the player is in an order it has no name for.
	const mode = player?.jeanPlaybackMode ?? null;
	const modeOrdinal = mode !== null ? JEAN_ORDER.indexOf(mode) : -1;

	// beefweb's `options` is an open list carrying both enum and bool entries, so the value is only a
	// number when this really is the enum one; `jeanPlaybackMode` is the one still fed by anything.
	const value =
		(modeOrdinal >= 0 ? modeOrdinal : undefined) ??
		(typeof option?.value === "number" ? option.value : player?.playbackMode) ??
		0;

	const offeredModes = capabilities?.playbackModes ?? [];
	const shuffleMode = useMemo(
		() => findShuffleMode(offeredModes),
		[offeredModes],
	);
	const isShuffle = shuffleMode !== null && mode === shuffleMode;

	const isInOrder = mode === null ? value === 0 : mode === "inOrder";

	const previousOrder = useRef(0);
	if (!isShuffle && value !== previousOrder.current)
		previousOrder.current = value;

	const hasOrderOption = capabilities !== null;
	const write = useCallback(
		(next: number) => setPlaybackOrder(next, hasOrderOption),
		[hasOrderOption],
	);

	const mutation = usePlayerPatch(write, (player, next: number) => ({
		playbackMode: next,
		jeanPlaybackMode: JEAN_ORDER[next] ?? player.jeanPlaybackMode,
		options: player.options?.map((entry) =>
			entry.id === "playbackOrder" ? { ...entry, value: next } : entry,
		),
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

export const useTransport = () => ({
	next: useMutation({ mutationFn: nextTrack }),
	previous: useMutation({ mutationFn: previousTrack }),
	stop: useMutation({ mutationFn: stop }),
});
