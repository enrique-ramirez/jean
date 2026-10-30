import { useEffect } from "react";
import { NOOP } from "@/shared/lib/noop";

export interface LeaveGuard {
	isDirty: () => boolean;
	ask: (discard: () => void, keep: () => void) => void;
}

const guards: LeaveGuard[] = [];
const goneListeners = new Set<(guard: LeaveGuard) => void>();

export const dirtyGuard = (): LeaveGuard | undefined =>
	guards.findLast((guard) => guard.isDirty());

export function onGuardGone(listener: (guard: LeaveGuard) => void) {
	goneListeners.add(listener);
	return () => {
		goneListeners.delete(listener);
	};
}

export function useLeaveGuard(guard: LeaveGuard) {
	useEffect(() => {
		guards.push(guard);
		return () => {
			const at = guards.indexOf(guard);
			if (at >= 0) guards.splice(at, 1);
			for (const listener of [...goneListeners]) listener(guard);
		};
	}, [guard]);
}

export function leaveGuarded(leave: () => void, keep: () => void = NOOP) {
	const guard = dirtyGuard();
	if (guard) guard.ask(leave, keep);
	else leave();
}
