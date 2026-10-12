import { useCallback, useRef, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

const listeners = subscribers();
const values = new Map<string, unknown>();

const resolve = <T>(fallback: T | (() => T)): T =>
	typeof fallback === "function" ? (fallback as () => T)() : fallback;

export type StoredShape<T> = (stored: unknown) => stored is T;

const read = <T>(
	key: string,
	fallback: T | (() => T),
	isShaped?: StoredShape<T>,
): T => {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return resolve(fallback);
		const stored: unknown = JSON.parse(raw);
		return !isShaped || isShaped(stored) ? (stored as T) : resolve(fallback);
	} catch {
		return resolve(fallback);
	}
};

const held = <T>(
	key: string,
	fallback: T | (() => T),
	isShaped?: StoredShape<T>,
): T => {
	if (!values.has(key)) values.set(key, read(key, fallback, isShaped));
	return values.get(key) as T;
};

export const readStoredState = <T>(
	key: string,
	fallback: T | (() => T),
	isShaped?: StoredShape<T>,
): T => held(key, fallback, isShaped);

export function writeStoredState<T>(key: string, value: T): void {
	values.set(key, value);
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private mode, quota: the setting just does not persist.
	}
	listeners.notify();
}

export function useStoredState<T>(
	key: string,
	fallback: T | (() => T),
	isShaped?: StoredShape<T>,
): [T, (next: T | ((current: T) => T)) => void] {
	// Read only on the first miss for a key, and deliberately not a dependency below: a caller passing
	// a fresh object literal must not invalidate the snapshot on every render.
	const onMiss = useRef({ fallback, isShaped });
	onMiss.current = { fallback, isShaped };

	const stored = useCallback(
		() => held(key, onMiss.current.fallback, onMiss.current.isShaped),
		[key],
	);

	const value = useSyncExternalStore(listeners.subscribe, stored);

	const update = useCallback(
		(next: T | ((current: T) => T)) => {
			const resolved =
				typeof next === "function"
					? (next as (current: T) => T)(stored())
					: next;

			writeStoredState(key, resolved);
		},
		[key, stored],
	);

	return [value, update];
}
