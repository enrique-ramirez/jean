import { useSyncExternalStore } from "react";
import { subscribers } from "./store";

/**
 * A one-shot request made where the thing that can grant it is not: queueing a track asks for the
 * queue panel, the now-playing header asks a list for the playing row. Neither raiser knows which
 * component will answer, which is what a prop would have to say.
 *
 * The ask stands until it is answered, because what answers it usually has to arrive or load first.
 */
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
