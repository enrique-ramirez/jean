import { useEffect, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

export const SETTINGS_KEYBOARD = "settings";
export const SHORTCUTS_KEYBOARD = "shortcuts";

const listeners = subscribers();
interface Claim {
	id: string;
}

let claims: readonly Claim[] = [];

export const keyboardOwner = () => claims.at(-1)?.id ?? null;

function setClaims(next: readonly Claim[]) {
	const before = keyboardOwner();
	claims = next;
	if (keyboardOwner() !== before) listeners.notify();
}

export function claimKeyboard(id: string) {
	const claim = { id };
	setClaims([...claims, claim]);

	return () => setClaims(claims.filter((held) => held !== claim));
}

export function useKeyboardOwnership(id: string, isActive = true) {
	useEffect(() => (isActive ? claimKeyboard(id) : undefined), [id, isActive]);
}

export const useKeyboardOwner = () =>
	useSyncExternalStore(listeners.subscribe, keyboardOwner);
