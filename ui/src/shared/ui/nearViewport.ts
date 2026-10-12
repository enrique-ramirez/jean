import { scrollParentOf } from "@/shared/lib/scrollParent";

const MARGIN_PX = 400;

type Seen = () => void;

const waiting = new WeakMap<Element, Seen>();

const observers = new WeakMap<Element | Document, IntersectionObserver>();

// An `IntersectionObserver` grows only its root by `rootMargin`, and with no root that is the
// browser's viewport: a scroll container in between still clips at its own edge.
const observerWithin = (scroller: Element | null) => {
	const held = observers.get(scroller ?? document);
	if (held) return held;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const seen = waiting.get(entry.target);
				waiting.delete(entry.target);
				observer.unobserve(entry.target);
				seen?.();
			}
		},
		{ root: scroller, rootMargin: `${MARGIN_PX}px` },
	);
	observers.set(scroller ?? document, observer);

	return observer;
};

export function whenNearViewport(element: Element, seen: Seen): () => void {
	if (typeof IntersectionObserver === "undefined") {
		seen();
		return () => {};
	}

	const observer = observerWithin(scrollParentOf(element));
	waiting.set(element, seen);
	observer.observe(element);

	return () => {
		waiting.delete(element);
		observer.unobserve(element);
	};
}
