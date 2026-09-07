import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

// A ref, not a position: the list that answers this is not the one that asked, and only the ref
// means the same thing in both. It stands until a list holding that row arrives -- a route opens
// before its rows do, and a browser that cannot answer yet must not swallow it.
const listeners = subscribers();
let wanted: number | null = null;

export function askToReveal(ref: number) {
	wanted = ref;
	listeners.notify();
}

export function revealed() {
	if (wanted === null) return;
	wanted = null;
	listeners.notify();
}

const read = () => wanted;

export const useRevealAsked = () =>
	useSyncExternalStore(listeners.subscribe, read, read);
