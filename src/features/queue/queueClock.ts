import { useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

// One timer for every countdown on screen. A module-level store rather than
// state in the panel, so a tick re-renders the spans and not the rows.

const listeners = subscribers();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

// The interval is the store's own resource: started by the first countdown to
// arrive and stopped after the last one leaves, so a Jean with no queue on
// screen is not waking up once a second to tell nobody.
const subscribe = (listener: () => void) => {
	const unsubscribe = listeners.subscribe(listener);
	timer ??= setInterval(() => {
		tick += 1;
		listeners.notify();
	}, 1000);

	return () => {
		unsubscribe();
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
