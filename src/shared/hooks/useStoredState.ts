import { useCallback, useRef, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

// One value per key, shared by every hook that names it: two callers of the same key must see each other's writes, which a per-caller useState reading localStorage at mount does not do.
// The write happens here rather than inside the setState updater, which React is entitled to call more than once for one update.
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

// The same reference until something writes, which is what useSyncExternalStore requires of a snapshot: a fresh object each call is an infinite render loop rather than a stale value.
const held = <T>(key: string, fallback: T | (() => T)): T => {
	if (!values.has(key)) values.set(key, read(key, fallback));
	return values.get(key) as T;
};

// The same value the hook sees, for a caller that is not a component. Reading `localStorage` directly instead would be a second parse of the same key and would miss a write this store has not flushed.
export const readStoredState = <T>(key: string, fallback: T | (() => T)): T =>
	held(key, fallback);

export function useStoredState<T>(
	key: string,
	fallback: T | (() => T),
): [T, (next: T | ((current: T) => T)) => void] {
	// Only ever read on the first miss for a key, so it is deliberately not a dependency below: a caller passing a fresh object literal must not invalidate the snapshot and re-render the tree every time.
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
