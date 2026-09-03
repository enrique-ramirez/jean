import { useEffect, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

// An overlay owns the keyboard while it is open; every scope but its own goes quiet.
const listeners = subscribers();
let owner: string | null = null;

// Last claim wins, and releasing restores the previous owner rather than the app, so two overlays at once unwind in order.
export function useKeyboardOwnership(id: string) {
	useEffect(() => {
		const previous = owner;
		owner = id;
		listeners.notify();

		return () => {
			if (owner !== id) return;
			owner = previous;
			listeners.notify();
		};
	}, [id]);
}

export const useKeyboardOwner = () =>
	useSyncExternalStore(
		listeners.subscribe,
		() => owner,
		() => null,
	);
