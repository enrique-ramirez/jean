import { type RefObject, useLayoutEffect } from "react";

// Pins a fixed element to the *visual* viewport rather than the layout one.
//
// This exists for the software keyboard. A `position: fixed` element is laid out
// against the layout viewport, and neither platform shrinks that when the
// keyboard comes up -- iOS does not resize it at all, Chrome defaults to
// `interactive-widget=resizes-visual` -- so a bottom-anchored sheet puts its own
// field under the keyboard the moment you tap it. Sizing to the visual viewport
// makes "above the keyboard" fall out of the existing `align-items: flex-end`,
// and following `offsetTop` as well covers iOS scrolling the page to reveal a
// focused field.
//
// Written to the element rather than through state: iOS fires a stream of these
// while the keyboard animates, and a render per frame would collide with the
// sheet's own drag transform on the same attribute.
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
