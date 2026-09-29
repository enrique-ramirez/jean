import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { orThrow, type Result } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	nextTrack,
	playPause,
	previousTrack,
	seekBy,
	seekTo,
	stop,
} from "@/shared/api/playback";
import { playPlaylistItem } from "@/shared/api/playlists";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { clamp } from "@/shared/lib/math";
import { sleep } from "@/shared/lib/sleep";
import { beginSeek } from "./listenerStore";
import { PLAYER_KEY, pollPlayerNow } from "./playerPoll";
import { useCommand, usePlayerPatch } from "./playerWrite";
import { audibleAt, positionAt } from "./position";

// `shared/api/README.md`, *What Jean does about playback*, has why.
const SKIP_APPLY_DELAY_MS = 250;

const useSkip = (command: (origin: string) => Promise<Result<unknown>>) => {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	return useCommand(discovery, async (origin) => {
		const skipped = await command(origin);
		if (!skipped.ok) return skipped;
		await sleep(SKIP_APPLY_DELAY_MS);
		await pollPlayerNow(queryClient, origin);
		return skipped;
	});
};

// The poll can lag a bare `playItem` post by up to `POLL_MS`, and `usePlaySet.ts` and
// `PlaylistView.tsx` both need the flip to "playing" to be visible at once.
export const usePlayItem = () => {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();

	return usePlayerPatch(
		async ({ playlistId, index }: { playlistId: string; index: number }) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await playPlaylistItem(origin, playlistId, index));
			await pollPlayerNow(queryClient, origin);
		},
		() => ({ playbackState: "playing" }),
	);
};

export const usePlayPause = () => {
	const { discovery } = useFooJean();
	return usePlayerPatch<void>(
		async () => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await playPause(origin));
		},
		(player, _input, previous) => ({
			playbackState: player.playbackState === "playing" ? "paused" : "playing",
			activeItem: {
				...player.activeItem,
				position: positionAt(previous, performance.now()),
			},
		}),
	);
};

export const useSeek = () => {
	const { discovery } = useFooJean();
	return usePlayerPatch(
		async (position: number) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await seekTo(origin, position));
		},
		(player, position: number) => {
			if (!player.activeItem) return null;
			beginSeek(position);
			return { activeItem: { ...player.activeItem, position } };
		},
	);
};

export const KEY_SEEK_SECONDS = 5;

export const useSeekBy = () => {
	const { discovery } = useFooJean();
	return usePlayerPatch(
		async (offset: number) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await seekBy(origin, offset));
		},
		(player, offset: number, previous) => {
			const item = player.activeItem;
			if (!item) return null;
			const position = clamp(
				positionAt(previous, performance.now()) + offset,
				0,
				item.duration ?? 0,
			);
			beginSeek(position);
			return { activeItem: { ...item, position } };
		},
	);
};

const RESTART_AFTER_SECONDS = 5;

export function usePrevious() {
	const queryClient = useQueryClient();
	const seek = useSeek().mutate;
	const skip = useSkip(previousTrack).mutate;

	return useCallback(
		(stepBack: () => void = () => skip()) => {
			const snapshot = queryClient.getQueryData<PlayerSnapshot>(PLAYER_KEY);
			if (audibleAt(snapshot) > RESTART_AFTER_SECONDS) seek(0);
			else stepBack();
		},
		[queryClient, seek, skip],
	);
}

export const useTransport = () => {
	const { discovery } = useFooJean();
	return {
		next: useSkip(nextTrack),
		previous: useSkip(previousTrack),
		stop: useCommand(discovery, stop),
	};
};
