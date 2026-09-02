import { type RefObject, useLayoutEffect, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

// Bounded rather than growing for the life of the tab: four panels times
// however many tracks get played.
const MAX_REMEMBERED = 40;

const offsets = new Map<string, number>();

/**
 * Where each panel was left, so switching tabs and coming back does not throw
 * away the paragraph you were reading.
 *
 * Not `app/useScrollMemory`, and the difference is not cosmetic: that one owns
 * the app's single, permanent scroll container and remembers a *route*. Here
 * the scroller is a different element on each layout -- the panel on a phone,
 * the whole screen on the gatefold -- and on the phone it is unmounted and
 * rebuilt on every tab change, which is what the slide animation needs. So this
 * re-resolves the element each time rather than holding one, and its key is a
 * panel *and* a track: a new song's lyrics are not the old song's scrolled down.
 */
export function usePanelScroll(
	panelRef: RefObject<HTMLElement | null>,
	key: string,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	const active = useRef(key);

	useLayoutEffect(() => {
		active.current = key;
		if (!enabled) return undefined;

		// Bounded at the layer, or a short panel resolves to the track list
		// scrolling behind the screen and this would restore *that*.
		const element = panelRef.current;
		const scroller =
			element &&
			(scrollParentOf(element, element.closest("[data-now-playing]")) ??
				// The panel may be the scroller itself, which `scrollParentOf` will
				// not answer with -- it only ever looks at ancestors.
				(element.scrollHeight > element.clientHeight ? element : null));
		if (!scroller) return undefined;

		scroller.scrollTop = offsets.get(key) ?? 0;

		const onScroll = () => {
			offsets.set(active.current, scroller.scrollTop);
			if (offsets.size > MAX_REMEMBERED)
				offsets.delete(offsets.keys().next().value as string);
		};

		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, [key, panelRef, enabled]);
}
