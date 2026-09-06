import { useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

const listeners = subscribers();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

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

// A module constant, not a fresh closure per render: `useSyncExternalStore` tears down and reinstalls a subscription
// whose function identity changed.
const never = () => () => {};

export function useQueueClock(active: boolean) {
	return useSyncExternalStore(active ? subscribe : never, getSnapshot);
}
