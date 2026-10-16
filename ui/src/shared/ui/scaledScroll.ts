import {
	elementScroll,
	observeElementOffset,
	type VirtualItem,
	type Virtualizer,
} from "@tanstack/react-virtual";

export const MAX_SCROLL_HEIGHT = 15_000_000;

export function scaledHeight(contentHeight: number): number {
	return Math.min(contentHeight, MAX_SCROLL_HEIGHT);
}

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

// @tanstack/virtual-core's `setOptions` replaces `instance.options`, so nothing here holds them.
function shape<T extends Element>(instance: Virtualizer<T, Element>) {
	const total = instance.getTotalSize();
	const margin = instance.options.scrollMargin;
	const isScaled = total > MAX_SCROLL_HEIGHT;
	const height = instance.scrollElement?.clientHeight ?? 0;
	const room = isScaled
		? Math.max(
				0,
				(instance.scrollElement?.scrollHeight ?? 0) -
					margin -
					scaledHeight(total),
			)
		: 0;
	return { margin, total, room, viewport: height - room, isScaled };
}

export function scrollScaleOf<T extends Element>(
	instance: Virtualizer<T, Element>,
): number {
	const { total, viewport } = shape(instance);
	return scrollScale(total, viewport);
}

export function isScaled<T extends Element>(
	instance: Virtualizer<T, Element>,
): boolean {
	return instance.getTotalSize() > MAX_SCROLL_HEIGHT;
}

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

// @tanstack/virtual-core's `adjustments` are content pixels.
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

// @tanstack/virtual-core's `getOffsetForIndex` clamps to the scroller's own height.
export function scrollTopFor<T extends HTMLElement>(
	instance: Virtualizer<T, Element>,
	item: VirtualItem,
	align: "center" | "auto",
): number {
	const view = instance.scrollElement?.clientHeight ?? 0;
	const current = instance.scrollOffset ?? 0;
	const isAbove = align === "auto" && item.start < current;
	const isBelow = align === "auto" && !isAbove && item.end > current + view;
	if (align === "auto" && !isAbove && !isBelow)
		return instance.scrollElement?.scrollTop ?? 0;
	const wanted =
		align === "center"
			? item.start + (item.size - view) / 2
			: isAbove
				? item.start
				: item.end - view;
	const { margin, total, room } = shape(instance);
	const last = margin + total + room - view;
	const top = scrollTopOf(instance, Math.min(Math.max(wanted, 0), last));
	// A browser holds scrollTop in whole pixels, so rounding toward the row keeps its edge inside the view.
	return isBelow ? Math.ceil(top) : isAbove ? Math.floor(top) : top;
}

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
const YIELDS_TO = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

// Chromium holds a scrollTop this large only to a grid of its own (every second pixel at 12,000,000).
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
		for (const event of YIELDS_TO) element.removeEventListener(event, stop);
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

	for (const event of YIELDS_TO)
		element.addEventListener(event, stop, { passive: true });
	handle = requestAnimationFrame(step);
	return stop;
}

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
