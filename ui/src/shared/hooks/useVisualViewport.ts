import { type RefObject, useLayoutEffect } from "react";

// `position: fixed` is laid out against the layout viewport, which neither iOS nor Chrome shrinks for
// the software keyboard. The visual viewport follows it, and iOS also scrolls it to reveal a field.
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
