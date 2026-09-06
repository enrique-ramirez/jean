import { type RefObject, useLayoutEffect, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

const MAX_REMEMBERED = 40;

const offsets = new Map<string, number>();

export function usePanelScroll(
	panelRef: RefObject<HTMLElement | null>,
	key: string,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	const active = useRef(key);

	useLayoutEffect(() => {
		active.current = key;
		if (!enabled) return undefined;

		const element = panelRef.current;
		const scroller =
			element &&
			(scrollParentOf(element, element.closest("[data-now-playing]")) ??
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
