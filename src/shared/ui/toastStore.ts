import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	action: ToastAction | null;
	tone: "default" | "error";
}

// A module-level store rather than a context: a provider holding the list would re-render everything beneath it whenever a toast appeared or expired, including the virtualised track list.

// Older ones are dropped rather than stacked past this: a column of them covers the thing being reported.
const MAX_VISIBLE = 3;
const WITH_ACTION_MS = 9000;
const PLAIN_MS = 5000;

const listeners = subscribers();
const timers = new Map<number, number>();

let toasts: Toast[] = [];
let nextId = 1;

const stopTimer = (id: number): void => {
	clearTimeout(timers.get(id));
	timers.delete(id);
};

export function dismissToast(id: number) {
	const next = toasts.filter((toast) => toast.id !== id);
	if (next.length === toasts.length) return;
	stopTimer(id);
	toasts = next;
	listeners.notify();
}

export function pushToast({
	message,
	action = null,
	tone = "default",
	duration,
}: {
	message: string;
	action?: ToastAction | null;
	tone?: Toast["tone"];
	duration?: number;
}) {
	const id = nextId;
	nextId += 1;

	const shown = [...toasts, { id, message, action, tone }];
	shown.slice(0, Math.max(0, shown.length - MAX_VISIBLE)).forEach((toast) => {
		stopTimer(toast.id);
	});
	toasts = shown.slice(-MAX_VISIBLE);

	const ms = duration ?? (action ? WITH_ACTION_MS : PLAIN_MS);
	if (ms > 0)
		timers.set(
			id,
			setTimeout(() => dismissToast(id), ms),
		);

	listeners.notify();
	return id;
}

const snapshot = () => toasts;

export const useToasts = () =>
	useSyncExternalStore(listeners.subscribe, snapshot, snapshot);
