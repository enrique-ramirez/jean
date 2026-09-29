import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

type Reach = "connected" | "reconnecting" | "stillReconnecting";

export type ConnectionState = Reach | "playerUnresponsive";

export const RECONNECTING_AFTER_MS = 3000;
export const REMEDY_AFTER_MS = 10_000;

// On top of the wait `foo_jean` makes before it reports a stall, so one that ends within a poll or
// two of being reported draws nothing.
export const UNRESPONSIVE_AFTER_MS = 2000;

const listeners = subscribers();

let reach: Reach = "connected";
let unresponsive = false;
let reachTimers: ReturnType<typeof setTimeout>[] = [];
let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;

const current = (): ConnectionState =>
	reach !== "connected"
		? reach
		: unresponsive
			? "playerUnresponsive"
			: "connected";

function settle(change: () => void) {
	const before = current();
	change();
	if (current() !== before) listeners.notify();
}

const remainingOf = (askedAt: number, ms: number) =>
	Math.max(0, askedAt + ms - performance.now());

export function notePlayerReached() {
	reachTimers.forEach(clearTimeout);
	reachTimers = [];
	settle(() => {
		reach = "connected";
	});
}

export function notePlayerUnreached(askedAt: number) {
	if (reachTimers.length > 0) return;
	const become = (next: Reach) => () =>
		settle(() => {
			reach = next;
		});
	reachTimers = [
		setTimeout(
			become("reconnecting"),
			remainingOf(askedAt, RECONNECTING_AFTER_MS),
		),
		setTimeout(
			become("stillReconnecting"),
			remainingOf(askedAt, REMEDY_AFTER_MS),
		),
	];
}

export function notePlayerAnswering(answering: boolean, askedAt: number) {
	if (answering) {
		if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
		unresponsiveTimer = null;
		settle(() => {
			unresponsive = false;
		});
		return;
	}
	if (unresponsive || unresponsiveTimer) return;
	unresponsiveTimer = setTimeout(
		() => {
			unresponsiveTimer = null;
			settle(() => {
				unresponsive = true;
			});
		},
		remainingOf(askedAt, UNRESPONSIVE_AFTER_MS),
	);
}

export const useConnection = () =>
	useSyncExternalStore(listeners.subscribe, current, current);
