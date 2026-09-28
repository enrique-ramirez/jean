import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

export type ConnectionState =
	| "connected"
	| "reconnecting"
	| "stillReconnecting";

export const RECONNECTING_AFTER_MS = 3000;
export const REMEDY_AFTER_MS = 10_000;

const listeners = subscribers();

let state: ConnectionState = "connected";
let timers: ReturnType<typeof setTimeout>[] = [];

function become(next: ConnectionState) {
	if (next === state) return;
	state = next;
	listeners.notify();
}

export function notePlayerReached() {
	timers.forEach(clearTimeout);
	timers = [];
	become("connected");
}

export function notePlayerUnreached(askedAt: number) {
	if (timers.length > 0) return;
	const after = (ms: number) => Math.max(0, askedAt + ms - performance.now());
	timers = [
		setTimeout(() => become("reconnecting"), after(RECONNECTING_AFTER_MS)),
		setTimeout(() => become("stillReconnecting"), after(REMEDY_AFTER_MS)),
	];
}

const snapshot = () => state;

export const useConnection = () =>
	useSyncExternalStore(listeners.subscribe, snapshot, snapshot);
