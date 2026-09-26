import { useCallback, useRef, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

const listeners = subscribers();
const values = new Map<string, unknown>();

const resolve = <T>(fallback: T | (() => T)): T =>
	typeof fallback === "function" ? (fallback as () => T)() : fallback;

const read = <T>(key: string, fallback: T | (() => T)): T => {
	try {
		const stored = localStorage.getItem(key);
		return stored === null ? resolve(fallback) : (JSON.parse(stored) as T);
	} catch {
		return resolve(fallback);
	}
};

const held = <T>(key: string, fallback: T | (() => T)): T => {
	if (!values.has(key)) values.set(key, read(key, fallback));
	return values.get(key) as T;
};

export const readStoredState = <T>(key: string, fallback: T | (() => T)): T =>
	held(key, fallback);

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
): [T, (next: T | ((current: T) => T)) => void] {
	// Read only on the first miss for a key, and deliberately not a dependency below: a caller passing
	// a fresh object literal must not invalidate the snapshot on every render.
	const initial = useRef(fallback);
	initial.current = fallback;

	const value = useSyncExternalStore(
		listeners.subscribe,
		useCallback(() => held(key, initial.current), [key]),
	);

	const update = useCallback(
		(next: T | ((current: T) => T)) => {
			const resolved =
				typeof next === "function"
					? (next as (current: T) => T)(held(key, initial.current))
					: next;

			writeStoredState(key, resolved);
		},
		[key],
	);

	return [value, update];
}
