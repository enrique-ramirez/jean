import { useEffect, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

export const AUTOPLAYLIST_KEYBOARD = "autoplaylist";
export const ACTION_MENU_KEYBOARD = "actionMenu";
export const SETTINGS_KEYBOARD = "settings";
export const SHORTCUTS_KEYBOARD = "shortcuts";

const listeners = subscribers();
interface Claim {
	id: string;
}

let claims: readonly Claim[] = [];

const ownerOf = () => claims.at(-1)?.id ?? null;

function setClaims(next: readonly Claim[]) {
	const before = ownerOf();
	claims = next;
	if (ownerOf() !== before) listeners.notify();
}

export function useKeyboardOwnership(id: string, isActive = true) {
	useEffect(() => {
		if (!isActive) return undefined;
		const claim = { id };
		setClaims([...claims, claim]);

		return () => setClaims(claims.filter((held) => held !== claim));
	}, [id, isActive]);
}

export const useKeyboardOwner = () =>
	useSyncExternalStore(listeners.subscribe, ownerOf);
