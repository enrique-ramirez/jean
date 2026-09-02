// The element that actually scrolls a given node, or null. Jean has surfaces
// whose scroller is a different box on each layout, and threading a ref down
// instead would make every component in between know which shape it is in.
//
// `offsetParent` answers a different question -- the nearest *positioned*
// ancestor -- which is what made following the active lyric line work on a phone
// and do nothing at all on a desktop.
export function scrollParentOf(
	node: Element | null,
	// Stop here. A surface drawn *over* another one -- the now-playing layer over
	// the track list -- must never answer with the scroller underneath it: the
	// walk would happily return the list's own scroll container, which is off
	// screen and belongs to something else entirely.
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
