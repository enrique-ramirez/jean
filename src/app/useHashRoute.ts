import { useCallback, useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

export function useHashRoute(): [string, (next: string) => void] {
	const hash = useSyncExternalStore(
		subscribe,
		() => window.location.hash,
		() => "",
	);

	const navigate = useCallback((next: string) => {
		window.location.hash = next;
	}, []);

	return [hash.replace(/^#\/?/, ""), navigate];
}
