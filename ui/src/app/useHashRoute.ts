import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
	listeners.add(onChange);
	window.addEventListener("hashchange", onChange);
	return () => {
		listeners.delete(onChange);
		window.removeEventListener("hashchange", onChange);
	};
};

export function useHashRoute(): [
	string,
	(next: string, options?: { replace?: boolean }) => void,
] {
	const hash = useSyncExternalStore(subscribe, () => window.location.hash);

	const navigate = useCallback(
		(next: string, options?: { replace?: boolean }) => {
			if (!options?.replace) {
				window.location.hash = next;
				return;
			}

			// `replaceState` fires no `hashchange`, unlike a plain hash assignment, so the
			// subscribers this hook hands out have to be told by hand.
			history.replaceState(
				null,
				"",
				`#${next.startsWith("/") ? next : `/${next}`}`,
			);
			for (const listener of [...listeners]) listener();
		},
		[],
	);

	return [hash.replace(/^#\/?/, ""), navigate];
}
