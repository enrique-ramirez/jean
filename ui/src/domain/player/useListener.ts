import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { Volume } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import {
	DEVICE_VOLUME_FLOOR_DB,
	DEVICE_VOLUME_STEP_DB,
	resolveListener,
} from "./listener";
import {
	configureListening,
	connect,
	disconnect,
	isListening,
	type ListenPhase,
	listeningServerSnapshot,
	listeningSnapshot,
	resume,
	retry,
	setListeningVolume,
	subscribeListening,
	toggleListeningMute,
} from "./listenerStore";
import { useVolume } from "./useVolume";

const deviceVolume = (value: number, isMuted: boolean): Volume => ({
	type: "db",
	min: DEVICE_VOLUME_FLOOR_DB,
	max: 0,
	value,
	isMuted,
});

export function useListener() {
	const { discovery } = useFooJean();

	const listener = useMemo(() => resolveListener(discovery), [discovery]);
	const { target } = listener;

	useEffect(() => {
		configureListening(target);
	}, [target]);

	const live = useSyncExternalStore(
		subscribeListening,
		listeningSnapshot,
		listeningServerSnapshot,
	);

	const isOn = isListening(live.phase);

	const toggle = useCallback(() => {
		if (isOn) disconnect();
		else connect();
	}, [isOn]);

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
		resume,
		retry,
		toggle,
	};
}

export function useAudibleVolume() {
	const listener = useListener();
	const player = useVolume();

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
		volume,
		setValue,
		hasFader: !isHere || Boolean(listener.volume),
		toggleMute: isHere ? listener.toggleMute : player.toggleMuted,
		up: () => nudge(DEVICE_VOLUME_STEP_DB),
		down: () => nudge(-DEVICE_VOLUME_STEP_DB),
	};
}

export type { ListenPhase };
