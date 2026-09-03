// The element that actually scrolls a given node, or null.
// offsetParent answers a different question, the nearest positioned ancestor, and is not a substitute.
export function scrollParentOf(
	node: Element | null,
	// Stop here: a surface drawn over another one must not answer with the scroller underneath it, which is off screen and belongs to something else.
	boundary?: Element | null,
): HTMLElement | null {
	let element = node?.parentElement ?? null;

	while (element) {
		const { overflowY } = getComputedStyle(element);
		if (
			(overflowY === "auto" || overflowY === "scroll") &&
			element.scrollHeight > element.clientHeight
		)
			return element;
		if (element === boundary) return null;
		element = element.parentElement;
	}

	return null;
}
