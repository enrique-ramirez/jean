import { useCallback, useMemo, useRef } from "react";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { setPlaybackOrder } from "@/shared/api/playback";
import type { PlaybackMode } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
import { usePlayerPatch } from "./playerWrite";
import { usePlayer } from "./usePlayer";

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

const NOT_OFFERED: PlaybackMode[] = [];

const findShuffleMode = (offered: PlaybackMode[]) =>
	SHUFFLE_PRIORITY.find((mode) => offered.includes(mode)) ?? null;

export function usePlaybackOrder() {
	const { data } = usePlayer();
	const { discovery } = useFooJean();

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

	const previousOrder = useRef<PlaybackMode>("inOrder");
	const effectiveMode = mode ?? "inOrder";
	if (!isShuffle && effectiveMode !== previousOrder.current)
		previousOrder.current = effectiveMode;

	const mutation = usePlayerPatch(
		async (next: PlaybackMode) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await setPlaybackOrder(origin, next));
		},
		(_player, next: PlaybackMode) => ({ playbackMode: next }),
	);

	const { mutate } = mutation;

	const toggleShuffle = useCallback(() => {
		if (shuffleMode === null) return;
		mutate(isShuffle ? previousOrder.current : shuffleMode);
	}, [isShuffle, shuffleMode, mutate]);

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

	return {
		mode,
		offered: offeredModes,
		setOrder,
		isShuffle,
		canShuffle: shuffleMode !== null,
		orderName: mode ? translate(ORDER_NAME_PHRASE[mode]) : null,
		isInOrder,
		toggleShuffle,
		enableShuffle,
	};
}
