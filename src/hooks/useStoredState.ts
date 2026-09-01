import { useCallback, useState } from "react";

// Local for now. These are exactly the values that should end up in beefweb's
// /api/clientconfig so they follow the user between devices — the signature is
// deliberately the same shape a server-backed version would have.
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

export function useStoredState<T>(
	key: string,
	fallback: T | (() => T),
): [T, (next: T | ((current: T) => T)) => void] {
	const [value, setValue] = useState<T>(() => read(key, fallback));

	const update = useCallback(
		(next: T | ((current: T) => T)) => {
			setValue((current) => {
				const resolved =
					typeof next === "function" ? (next as (c: T) => T)(current) : next;
				try {
					localStorage.setItem(key, JSON.stringify(resolved));
				} catch {
					// Private mode, quota — the setting just does not persist.
				}
				return resolved;
			});
		},
		[key],
	);

	return [value, update];
}
