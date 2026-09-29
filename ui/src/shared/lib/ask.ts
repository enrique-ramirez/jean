import { useSyncExternalStore } from "react";
import { subscribers } from "./store";

export function createAsk<T>() {
	const listeners = subscribers();
	let asked: T | null = null;
	const read = () => asked;

	return {
		ask: (value: T) => {
			asked = value;
			listeners.notify();
		},
		answered: () => {
			if (asked === null) return;
			asked = null;
			listeners.notify();
		},
		useAsked: () => useSyncExternalStore(listeners.subscribe, read),
	};
}
