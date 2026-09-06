import { type RefObject, useLayoutEffect } from "react";

// A fixed element is laid out against the layout viewport, which neither platform shrinks for the
// software keyboard, so a bottom-anchored sheet puts its own field under it.
// Written to the element rather than through state: iOS fires a stream of these while the keyboard
// animates.
export function useVisualViewport(ref: RefObject<HTMLElement | null>) {
	useLayoutEffect(() => {
		const viewport = window.visualViewport;
		const element = ref.current;
		if (!viewport || !element) return undefined;

		const apply = () => {
			element.style.top = `${viewport.offsetTop}px`;
			element.style.height = `${viewport.height}px`;
		};

		apply();
		viewport.addEventListener("resize", apply);
		viewport.addEventListener("scroll", apply);

		return () => {
			viewport.removeEventListener("resize", apply);
			viewport.removeEventListener("scroll", apply);
		};
	}, [ref]);
}
