import { useSyncExternalStore } from "react";

// One MediaQueryList per query, held for the life of the tab. Making a fresh
// one in `subscribe` and `getSnapshot` -- both of which run on every render --
// meant tearing down and re-adding a listener each time, for a value that
// changes when the window is resized.
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

// The JavaScript breakpoint, and it is not the CSS one. This drives the things
// that are a different *component* below it -- the sidebar becoming a drawer,
// the action sheet instead of a popover. Anything that is the same component at
// a different *size* belongs to a media query in CSS. See CLAUDE.md.
export const useIsCompactViewport = () => useMediaQuery("(max-width: 860px)");
