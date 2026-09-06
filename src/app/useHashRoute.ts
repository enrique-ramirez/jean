import { useCallback, useSyncExternalStore } from "react";

// Hash routing rather than history: beefweb's static server has no SPA fallback, so `/playlists/p2` would be a genuine 404 once Jean is served from the player.
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
