import { useSyncExternalStore } from "react";

// One MediaQueryList per query, held for the life of the tab: `subscribe` and `getSnapshot` both run
// on every render, so a fresh one tears down and re-adds a listener each time.
interface QueryStore {
	subscribe: (onChange: () => void) => () => void;
	matches: () => boolean;
}

const stores = new Map<string, QueryStore>();

const storeFor = (query: string): QueryStore => {
	if (!stores.has(query)) {
		const list = window.matchMedia(query);
		stores.set(query, {
			subscribe: (onChange) => {
				list.addEventListener("change", onChange);
				return () => list.removeEventListener("change", onChange);
			},
			matches: () => list.matches,
		});
	}
	return stores.get(query) as QueryStore;
};

export function useMediaQuery(query: string): boolean {
	const store = storeFor(query);
	return useSyncExternalStore(store.subscribe, store.matches, () => false);
}

export const useIsCompactViewport = () => useMediaQuery("(max-width: 860px)");
