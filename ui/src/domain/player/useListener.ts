import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { permitsPlaybackControl } from "@/shared/api/discovery";
import type { Volume } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import {
	DEVICE_VOLUME_FLOOR_DB,
	DEVICE_VOLUME_STEP_DB,
	resolveListener,
} from "./listener";
import {
	configureListening,
	isListening,
	type ListenPhase,
	listeningSnapshot,
	pauseHere,
	playHere,
	resume,
	retry,
	setListeningVolume,
	subscribeListening,
	toggleListeningMute,
} from "./listenerStore";
import { sessionSnapshot, useInSession, useSessionId } from "./session";
import { useSessionActions } from "./sessionOperations";
import { useVolume } from "./useVolume";

const deviceVolume = (value: number, isMuted: boolean): Volume => ({
	type: "db",
	min: DEVICE_VOLUME_FLOOR_DB,
	max: 0,
	value,
	isMuted,
});

export function useListener() {
	const { discovery, isDiscovered } = useFooJean();

	const listener = useMemo(() => resolveListener(discovery), [discovery]);
	const { target } = listener;

	const sessionId = useSessionId();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `sessionId` fires this; the session is read from the store when it runs.
	useEffect(() => {
		if (!isDiscovered) return;
		configureListening(target && { ...target, session: sessionSnapshot().id });
	}, [isDiscovered, target, sessionId]);

	const live = useSyncExternalStore(subscribeListening, listeningSnapshot);

	const isOn = isListening(live.phase);

	const { listen: connect, stop: disconnect } = useSessionActions();
	const toggle = useCallback(
		() => (isOn ? disconnect() : connect()),
		[isOn, connect, disconnect],
	);

	return {
		canListen: listener.canListen,
		lowLatencyFellBack: live.lowLatencyFellBack,
		formats: listener.formats,
		phase: live.phase,
		format: live.format,
		isOn,
		volume: live.canSetVolume
			? deviceVolume(live.volumeDb, live.isMuted)
			: null,
		canSetVolume: live.canSetVolume,
		setVolume: setListeningVolume,
		toggleMute: toggleListeningMute,
		connect,
		disconnect,
		pauseHere,
		playHere,
		resume,
		retry,
		toggle,
	};
}

export function useAudibleVolume() {
	const listener = useListener();
	const player = useVolume();
	const { discovery } = useFooJean();
	const inSession = useInSession();

	const isHere = listener.isOn;
	const volume = isHere ? listener.volume : player.volume;
	const setValue = isHere ? listener.setVolume : player.setValue;

	const nudge = (step: number) => {
		if (!isHere) {
			if (step > 0) player.up();
			else player.down();
			return;
		}
		if (volume) setValue(volume.value + step);
	};

	return {
		isHere,
		canMove: isHere || (!inSession && permitsPlaybackControl(discovery)),
		volume,
		setValue,
		hasFader: isHere ? Boolean(listener.volume) : !inSession,
		toggleMute: isHere ? listener.toggleMute : player.toggleMuted,
		up: () => nudge(DEVICE_VOLUME_STEP_DB),
		down: () => nudge(-DEVICE_VOLUME_STEP_DB),
	};
}

export type { ListenPhase };
