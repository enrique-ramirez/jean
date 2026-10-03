import { useRef, useState, useSyncExternalStore } from "react";

import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { subscribers } from "@/shared/lib/store";

const TENTHS = 10;
// A float a hair under a tenth must not read as the tenth before.
const NUDGE = 1e-6;

export const wholeTenths = (seconds: number) =>
	Math.floor(seconds * TENTHS + NUDGE) / TENTHS;

export interface AudibleClock {
	now: () => number;
	seen: () => number;
	subscribe: (listener: () => void) => () => void;
}

function audibleClock(read: () => number): AudibleClock {
	const listeners = subscribers();
	let seen = read();
	let frame = 0;

	const tick = () => {
		seen = read();
		listeners.notify();
		frame = requestAnimationFrame(tick);
	};

	return {
		now: read,
		seen: () => seen,
		subscribe: (listener) => {
			const unsubscribe = listeners.subscribe(listener);
			if (listeners.size === 1) {
				seen = read();
				frame = requestAnimationFrame(tick);
			}
			return () => {
				unsubscribe();
				if (listeners.size === 0) cancelAnimationFrame(frame);
			};
		},
	};
}

export function useAudibleClock(
	snapshot: PlayerSnapshot | null | undefined,
): AudibleClock {
	const latest = useRef(snapshot);
	latest.current = snapshot;
	const [clock] = useState(() => audibleClock(() => audibleAt(latest.current)));
	return clock;
}

export function useAudibleValue<T extends string | number>(
	clock: AudibleClock,
	pick: (seconds: number) => T,
): T {
	return useSyncExternalStore(clock.subscribe, () => pick(clock.seen()));
}
