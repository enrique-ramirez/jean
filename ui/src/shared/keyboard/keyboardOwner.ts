import { useEffect, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

export const SETTINGS_KEYBOARD = "settings";
export const SHORTCUTS_KEYBOARD = "shortcuts";

const listeners = subscribers();
let owner: string | null = null;

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
	useSyncExternalStore(listeners.subscribe, () => owner);
