import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

interface Jump {
	animate: boolean;
}

const listeners = subscribers();
let asked: Jump | null = null;

export function askToJump(jump: Jump = { animate: false }) {
	asked = jump;
	listeners.notify();
}

export function jumpAnswered() {
	if (asked === null) return;
	asked = null;
	listeners.notify();
}

const read = () => asked;

export const useJumpAsked = () =>
	useSyncExternalStore(listeners.subscribe, read, read);
