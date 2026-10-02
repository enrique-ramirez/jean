import { useCallback, useMemo } from "react";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { setPlaybackOrder } from "@/shared/api/playback";
import type { PlaybackMode } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { usePlayerPatch } from "./playerWrite";
import { usePlayer } from "./usePlayer";

const SHUFFLE_PRIORITY: PlaybackMode[] = ["shuffleTracks", "random"];

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

const NOT_OFFERED: PlaybackMode[] = [];

const findShuffleMode = (offered: PlaybackMode[]) =>
	SHUFFLE_PRIORITY.find((mode) => offered.includes(mode)) ?? null;

export function usePlaybackOrder() {
	const { data } = usePlayer();
	const { discovery } = useFooJean();
	const t = useTranslate();

	const player = data?.player;

	const capabilities =
		discovery.state.kind === "ready" ? discovery.state.capabilities : null;

	const mode = player?.playbackMode ?? null;

	const offeredModes = capabilities?.playbackModes ?? NOT_OFFERED;
	const shuffleMode = useMemo(
		() => findShuffleMode(offeredModes),
		[offeredModes],
	);
	const isShuffle = shuffleMode !== null && mode === shuffleMode;

	const isInOrder = mode === "inOrder";

	const mutation = usePlayerPatch(
		async (next: PlaybackMode) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await setPlaybackOrder(origin, next));
		},
		(_player, next: PlaybackMode) => ({ playbackMode: next }),
	);

	const { mutate } = mutation;

	const enableShuffle = useCallback(() => {
		if (shuffleMode === null || isShuffle) return;
		mutate(shuffleMode);
	}, [isShuffle, shuffleMode, mutate]);

	const setOrder = useCallback(
		(next: PlaybackMode) => {
			if (next !== mode) mutate(next);
		},
		[mode, mutate],
	);

	const nameOf = useCallback(
		(of: PlaybackMode) => t(ORDER_NAME_PHRASE[of]),
		[t],
	);

	return {
		mode,
		nameOf,
		offered: offeredModes,
		setOrder,
		canShuffle: shuffleMode !== null,
		isInOrder,
		enableShuffle,
	};
}
