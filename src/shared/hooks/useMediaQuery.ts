import { useSyncExternalStore } from "react";

// One MediaQueryList per query, held for the life of the tab: a fresh one in subscribe and getSnapshot, both of which run on every render, tears down and re-adds a listener each time.
interface QueryStore {
	subscribe: (onChange: () => void) => () => void;
	matches: () => boolean;
}

const lists = new Map<string, QueryStore>();

const listFor = (query: string): QueryStore => {
	if (!lists.has(query)) {
		const list = window.matchMedia(query);
		lists.set(query, {
			subscribe: (onChange) => {
				list.addEventListener("change", onChange);
				return () => list.removeEventListener("change", onChange);
			},
			matches: () => list.matches,
		});
	}
	return lists.get(query) as QueryStore;
};

export function useMediaQuery(query: string): boolean {
	const list = listFor(query);
	return useSyncExternalStore(list.subscribe, list.matches, () => false);
}

// The JavaScript breakpoint, and it is not the CSS one: this drives what is a different component below it, while the same component at a different size belongs to a media query in CSS.
export const useIsCompactViewport = () => useMediaQuery("(max-width: 860px)");
