import { useCallback, useEffect, useRef, useState } from "react";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	setMuted,
	setVolume,
	volumeDown,
	volumeUp,
} from "@/shared/api/playback";
import { useCoalescedWrite } from "@/shared/hooks/useCoalescedWrite";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { VOLUME_SETTLE_MS } from "./playerPoll";
import {
	reportPlaybackRefusal,
	useCommand,
	usePlayerPatch,
} from "./playerWrite";
import { usePlayer } from "./usePlayer";

const VOLUME_EPSILON = 0.5;

export function useVolume() {
	const { data } = usePlayer();
	const { discovery, recheck } = useFooJean();
	const send = useCoalescedWrite(
		async (value: number) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await setVolume(origin, value));
		},
		(error) => reportPlaybackRefusal(error, recheck),
	);
	const mute = usePlayerPatch(
		async (isMuted: boolean) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await setMuted(origin, isMuted));
		},
		(player, isMuted: boolean) => ({
			volume: { ...player.volume, isMuted },
		}),
	);
	const nudgeUp = useCommand(discovery, volumeUp);
	const nudgeDown = useCommand(discovery, volumeDown);

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
