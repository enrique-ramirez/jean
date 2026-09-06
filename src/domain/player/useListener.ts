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
import { useVolume } from "./usePlayer";

// This device's volume, shaped like the player's, because the status bar's fader points at one or the other and never at both.
// foo_jean captures audio before foobar2000's own volume, so while the sound is here the player's fader changes nothing anyone can hear.
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

	// Idempotent in the store, so two callers stating the same target do not tear down each other's connection.
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
		// The connection gave up on the short buffer. Distinct from the setting, which says what to try.
		lowLatencyFellBack: live.lowLatencyFellBack,
		formats: listener.formats,
		phase: live.phase,
		format: live.format,
		isOn,
		// Null where the platform will not have it: on iOS `audio.volume` is a documented no-op and the hardware keys are the only volume there is.
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

// The fader anyone can actually hear: this device's while a stream is attached, the player's otherwise.
// One hook rather than the routing written out per caller, because a control and the key bound to it must not point at different targets.
export function useAudibleVolume() {
	const listener = useListener();
	const player = useVolume();

	const isHere = listener.isOn;
	const volume = isHere ? listener.volume : player.volume;
	const setValue = isHere ? listener.setVolume : player.setValue;

	// The player has its own step; where the sound is here, that endpoint is inaudible and the level moves by ours.
	// A device that will not report one, as iOS does not, gets no nudge rather than a nudge aimed at the player.
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
