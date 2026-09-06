import { useSyncExternalStore } from "react";
import { subscribers } from "./store";

export function createAsk() {
	const listeners = subscribers();
	let asked = false;

	const set = (next: boolean) => {
		if (asked === next) return;
		asked = next;
		listeners.notify();
	};

	return {
		ask: () => set(true),
		answered: () => set(false),
		useAsked: () =>
			useSyncExternalStore(
				listeners.subscribe,
				() => asked,
				() => asked,
			),
	};
}
