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
	tone: "default" | "error" | "neutral";
}

const MAX_VISIBLE = 3;
const WITH_ACTION_MS = 9000;
const PLAIN_MS = 5000;

interface Countdown {
	hold: () => void;
	release: () => void;
	stop: () => void;
}

const countdown = (ms: number, onElapsed: () => void): Countdown => {
	let handle: ReturnType<typeof setTimeout> | null = setTimeout(onElapsed, ms);
	let startedAt = performance.now();
	let left = ms;
	let holds = 0;

	return {
		hold: () => {
			holds += 1;
			if (handle === null) return;
			clearTimeout(handle);
			handle = null;
			left -= performance.now() - startedAt;
		},
		release: () => {
			holds = Math.max(0, holds - 1);
			if (holds > 0 || handle !== null) return;
			startedAt = performance.now();
			handle = setTimeout(onElapsed, Math.max(0, left));
		},
		stop: () => {
			if (handle !== null) clearTimeout(handle);
			handle = null;
		},
	};
};

const listeners = subscribers();
const timers = new Map<number, Countdown>();

let toasts: Toast[] = [];
let nextId = 1;

const stopTimer = (id: number): void => {
	timers.get(id)?.stop();
	timers.delete(id);
};

export const holdToast = (id: number): void => timers.get(id)?.hold();

export const releaseToast = (id: number): void => timers.get(id)?.release();

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

	const all = [...toasts, { id, message, action, tone }];
	all.slice(0, Math.max(0, all.length - MAX_VISIBLE)).forEach((toast) => {
		stopTimer(toast.id);
	});
	toasts = all.slice(-MAX_VISIBLE);

	const ms = duration ?? (action ? WITH_ACTION_MS : PLAIN_MS);
	if (ms > 0)
		timers.set(
			id,
			countdown(ms, () => dismissToast(id)),
		);

	listeners.notify();
	return id;
}

const snapshot = () => toasts;

export const useToasts = () =>
	useSyncExternalStore(listeners.subscribe, snapshot);
