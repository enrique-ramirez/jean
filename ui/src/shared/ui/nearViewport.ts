const MARGIN_PX = 400;

type Seen = () => void;

const waiting = new WeakMap<Element, Seen>();

let observer: IntersectionObserver | null = null;

const observerFor = () => {
	if (observer) return observer;

	observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const seen = waiting.get(entry.target);
				waiting.delete(entry.target);
				observer?.unobserve(entry.target);
				seen?.();
			}
		},
		{ rootMargin: `${MARGIN_PX}px` },
	);

	return observer;
};

export function whenNearViewport(element: Element, seen: Seen): () => void {
	if (typeof IntersectionObserver === "undefined") {
		seen();
		return () => {};
	}

	waiting.set(element, seen);
	observerFor().observe(element);

	return () => {
		waiting.delete(element);
		observer?.unobserve(element);
	};
}
