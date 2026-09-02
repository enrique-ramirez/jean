import { useSyncExternalStore } from "react";

// One timer for every countdown on screen. A module-level store rather than
// state in the panel, so a tick re-renders the spans and not the rows.

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	timer ??= setInterval(() => {
		tick += 1;
		for (const notify of listeners) notify();
	}, 1000);

	return () => {
		listeners.delete(listener);
		if (listeners.size > 0 || !timer) return;
		clearInterval(timer);
		timer = null;
	};
};

const getSnapshot = () => tick;

// Off while playback is not playing, where the numbers are standing still.
export function useQueueClock(active: boolean) {
	return useSyncExternalStore(active ? subscribe : () => () => {}, getSnapshot);
}
