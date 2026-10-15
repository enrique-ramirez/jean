import {
	elementScroll,
	observeElementOffset,
	type VirtualItem,
	type Virtualizer,
} from "@tanstack/react-virtual";

// Firefox stops growing an element at 17,895,697 px; this leaves 2,895,697 px of room.
export const MAX_SCROLL_HEIGHT = 15_000_000;

export function scaledHeight(contentHeight: number): number {
	return Math.min(contentHeight, MAX_SCROLL_HEIGHT);
}

// Content pixels per scroll pixel. Compares the scrollable ranges, not the heights, so the last
// scrollTop lands on the last content offset and the scale is exactly 1 at or under the cap.
export function scrollScale(contentHeight: number, viewport = 0): number {
	if (contentHeight <= MAX_SCROLL_HEIGHT) return 1;
	return (contentHeight - viewport) / (MAX_SCROLL_HEIGHT - viewport);
}

export function toContentOffset(
	scrollTop: number,
	contentHeight: number,
	viewport = 0,
): number {
	return scrollTop * scrollScale(contentHeight, viewport);
}

export function toScrollTop(
	contentOffset: number,
	contentHeight: number,
	viewport = 0,
): number {
	return contentOffset / scrollScale(contentHeight, viewport);
}

// The header above `scrollMargin` is drawn at its real height, so only the list below it is scaled.
// `getTotalSize()` and `clientHeight` are read per call because `setOptions` replaces
// `instance.options` and the list's height changes under a subscription.
function shape<T extends Element>(instance: Virtualizer<T, Element>) {
	const total = instance.getTotalSize();
	return {
		margin: instance.options.scrollMargin,
		total,
		viewport: instance.scrollElement?.clientHeight ?? 0,
		isScaled: total > MAX_SCROLL_HEIGHT,
	};
}

export function isScaled<T extends Element>(
	instance: Virtualizer<T, Element>,
): boolean {
	return instance.getTotalSize() > MAX_SCROLL_HEIGHT;
}

// A scrollTop at or under the cap is returned as it came, since adding the margin back to a
// subtracted one is not exact for every fraction.
export function contentOffsetOf<T extends Element>(
	instance: Virtualizer<T, Element>,
	scrollTop: number,
): number {
	const { margin, total, viewport, isScaled } = shape(instance);
	const local = scrollTop - margin;
	if (!isScaled || local <= 0) return scrollTop;
	return margin + toContentOffset(local, total, viewport);
}

export function scrollTopOf<T extends Element>(
	instance: Virtualizer<T, Element>,
	contentOffset: number,
): number {
	const { margin, total, viewport, isScaled } = shape(instance);
	const local = contentOffset - margin;
	if (!isScaled || local <= 0) return contentOffset;
	return margin + toScrollTop(local, total, viewport);
}

// How far the scroller has moved the list's own box from where the virtualiser believes its rows
// are: a row at content offset `start` is drawn at `start - offset` on screen, so it is shifted
// by this much on top of its position in the list.
export function scrollShift<T extends Element>(
	instance: Virtualizer<T, Element>,
): number {
	if (!shape(instance).isScaled) return 0;
	const offset = instance.scrollOffset ?? 0;
	return offset - scrollTopOf(instance, offset);
}

export const scaledObserveElementOffset: typeof observeElementOffset = (
	instance,
	cb,
) =>
	observeElementOffset(instance, (scrollTop, isScrolling) => {
		cb(contentOffsetOf(instance, scrollTop), isScrolling);
	});

// The virtualiser's `adjustments` are content pixels, so they join the offset before it is mapped.
export const scaledScrollToFn: typeof elementScroll = (
	offset,
	{ adjustments = 0, behavior },
	instance,
) => {
	elementScroll(
		scrollTopOf(instance, offset + adjustments),
		{ behavior },
		instance,
	);
};

export const scaledVirtualizerOptions = {
	observeElementOffset: scaledObserveElementOffset,
	scrollToFn: scaledScrollToFn,
};

// `getOffsetForIndex` clamps to the scroller's own height, which over the cap stops short of the
// list's end, so the offset is worked out from the item's measurements instead.
export function scrollTopFor<T extends HTMLElement>(
	instance: Virtualizer<T, Element>,
	item: VirtualItem,
	align: "center" | "auto",
): number {
	const view = instance.scrollElement?.clientHeight ?? 0;
	const current = instance.scrollOffset ?? 0;
	const wanted =
		align === "center"
			? item.start + (item.size - view) / 2
			: item.start < current
				? item.start
				: item.end > current + view
					? item.end - view
					: null;
	if (wanted === null) return instance.scrollElement?.scrollTop ?? 0;
	const last = instance.options.scrollMargin + instance.getTotalSize() - view;
	return scrollTopOf(instance, Math.min(Math.max(wanted, 0), last));
}

// Rounded away from a value the browser has already refused, so the next nearest one is tried.
export function nextHeldScrollTop(
	refined: number,
	unheld: ReadonlySet<number>,
): number {
	const nearest = Math.round(refined);
	const side = refined >= nearest ? 1 : -1;
	return (
		[0, side, -side, 2 * side, -2 * side]
			.map((step) => nearest + step)
			.find((value) => !unheld.has(value)) ?? nearest
	);
}

const SETTLE_FRAMES = 240;
const SETTLE_STILL_FRAMES = 20;

// Moves the scroller until `centreOnRow` (a scrollTop, or null while the row is unmounted) agrees
// with where it is for a while, since a group measured after a jump changes the list's height and,
// over the cap, every offset with it. Chromium holds a scrollTop this large only to a grid of its
// own (every second pixel at 12,000,000), so a value it moved is not written again. A wheel or a
// touch stops it; the returned function does too.
export function settleOnRow(
	element: HTMLElement,
	centreOnRow: () => number | null,
): () => void {
	const unheld = new Set<number>();
	let lastWritten: number | null = null;
	let frames = SETTLE_FRAMES;
	let still = 0;
	let handle = 0;

	const stop = () => {
		frames = 0;
		cancelAnimationFrame(handle);
		element.removeEventListener("wheel", stop);
		element.removeEventListener("touchstart", stop);
	};

	const step = () => {
		const refined = centreOnRow();
		let moved = false;
		if (refined !== null) {
			if (lastWritten !== null && element.scrollTop !== lastWritten)
				unheld.add(lastWritten);
			const next = nextHeldScrollTop(refined, unheld);
			moved = next !== Math.round(element.scrollTop);
			if (moved) {
				element.scrollTop = next;
				lastWritten = next;
			}
		}
		still = moved || refined === null ? 0 : still + 1;
		if (--frames > 0 && still < SETTLE_STILL_FRAMES)
			handle = requestAnimationFrame(step);
		else stop();
	};

	element.addEventListener("wheel", stop, { passive: true });
	element.addEventListener("touchstart", stop, { passive: true });
	handle = requestAnimationFrame(step);
	return stop;
}

// Each scroller's virtualiser, so code that holds only the element (scroll memory) can map the
// scrollTop it reads and writes. An element with none registered maps as the identity.
const registered = new WeakMap<Element, Virtualizer<HTMLElement, Element>>();

export function registerScaledScroller(
	element: HTMLElement,
	instance: Virtualizer<HTMLElement, Element>,
): () => void {
	registered.set(element, instance);
	return () => {
		if (registered.get(element) === instance) registered.delete(element);
	};
}

export function contentOffsetOfElement(
	element: HTMLElement,
	scrollTop: number,
): number {
	const instance = registered.get(element);
	return instance ? contentOffsetOf(instance, scrollTop) : scrollTop;
}

export function scrollTopOfElement(
	element: HTMLElement,
	contentOffset: number,
): number {
	const instance = registered.get(element);
	return instance ? scrollTopOf(instance, contentOffset) : contentOffset;
}
