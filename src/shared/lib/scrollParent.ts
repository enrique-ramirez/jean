export function scrollParentOf(
	node: Element | null,
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
