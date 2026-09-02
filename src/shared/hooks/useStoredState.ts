import { useCallback, useRef, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";

// Local for now. These are exactly the values that should end up in beefweb's
// /api/clientconfig so they follow the user between devices — the signature is
// deliberately the same shape a server-backed version would have.
//
// **One value per key, shared by every hook that names it.** Held in a store
// rather than in each caller's `useState`, which read `localStorage` once at
// mount and so made a live pair out of every key with two readers.
// `jean.scratchPlaylist` is one: `App`'s home playback and a view's
// `useViewPlayback` both mount `useScratchPlaylist`, so the pin written by one
// was invisible to the other until a reload. What kept that safe was the pinned
// playlist's title being re-checked before it is trusted -- a guard that exists
// for a different reason and should not be the thing standing between a stale
// id and somebody's playlist being emptied.
//
// It also puts the write where a write belongs. It used to happen inside the
// `setState` updater, which React is entitled to call more than once for one
// update and does under StrictMode.
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

// The same reference until something writes, which is what `useSyncExternalStore`
// requires of a snapshot: returning a fresh object each call is an infinite
// render loop rather than a stale value.
const held = <T>(key: string, fallback: T | (() => T)): T => {
	if (!values.has(key)) values.set(key, read(key, fallback));
	return values.get(key) as T;
};

export function useStoredState<T>(
	key: string,
	fallback: T | (() => T),
): [T, (next: T | ((current: T) => T)) => void] {
	// Only ever read on the first miss for a key, so it is deliberately not a
	// dependency below: a caller passing a fresh object literal must not
	// invalidate the snapshot and re-render the tree every time.
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
