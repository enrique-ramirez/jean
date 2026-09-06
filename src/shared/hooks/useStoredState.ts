import { useCallback, useRef, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

// One value per key, shared by every hook that names it: two callers of one key must see each other's
// writes, which a `useState` per caller does not do.
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

// The same reference until something writes, which is what `useSyncExternalStore` requires of a
// snapshot: a fresh object each call is an infinite render loop rather than a stale value.
const held = <T>(key: string, fallback: T | (() => T)): T => {
	if (!values.has(key)) values.set(key, read(key, fallback));
	return values.get(key) as T;
};

export const readStoredState = <T>(key: string, fallback: T | (() => T)): T =>
	held(key, fallback);

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

			values.set(key, resolved);
			try {
				localStorage.setItem(key, JSON.stringify(resolved));
			} catch {
				// Private mode, quota — the setting just does not persist.
			}
			listeners.notify();
		},
		[key],
	);

	return [value, update];
}
