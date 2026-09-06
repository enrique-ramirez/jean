// Whether an element has come near enough to the viewport to be worth loading.
//
// One observer for the whole app rather than one per caller: a grid of a hundred and forty tiles is
// a hundred and forty observers otherwise, each with its own callback and its own bookkeeping, for
// one question asked the same way every time.
//
// It answers *once*. A cover that scrolls out of view keeps the picture it already has -- dropping it
// would make scrolling back up a second round of requests for bytes the browser still holds.

// Enough to fill in a screen ahead of a steady scroll without asking for the whole document. A jump
// that lands somewhere far away asks for what it landed on, which is the point.
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
				// Unobserved before the callback runs: the callback starts a request, and a second entry
				// for the same element while that is in flight would start another.
				waiting.delete(entry.target);
				observer?.unobserve(entry.target);
				seen?.();
			}
		},
		{ rootMargin: `${MARGIN_PX}px` },
	);

	return observer;
};

/**
 * Calls `seen` once, when the element is within a screen of the viewport. Returns the cancel.
 *
 * Callers that cannot use an observer at all -- a test environment without one -- are handed the
 * answer immediately, because failing open loads too much and failing closed shows nothing.
 */
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
