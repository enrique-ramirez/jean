import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import {
	autoscrollStep,
	landingOffset,
	offsetFor,
	type RowBox,
	targetFor,
} from "@/shared/lib/dragGeometry";

// The gesture in progress. tops is null until it turns out to be a drag rather than a click, because measuring is what the threshold buys.
interface Drag {
	from: number;
	to: number;
	startY: number;
	threshold: number;
	pointerId: number;
	captured: boolean;
	offset: number;
	scrolled: number;
	step: number;
	active: boolean;
	tops: RowBox[] | null;
}

// settled marks the window between letting go and keys changing, during which the transforms are held rather than cleared.
interface SortState extends Drag {
	tops: RowBox[];
	settled?: boolean;
}

// Reordering a short list by dragging it, on pointer events rather than HTML5 drag-and-drop. Rows are measured once, on drag start, so variable heights need no special case.

// Generous for a mouse: the row body is both the drag target and a link, so a click that wanders must not quietly rewrite the order.
const THRESHOLD_PX: Record<string, number> = { mouse: 6, touch: 8 };
// If the reorder never lands, stop holding the transforms rather than freezing the list in place.
const SETTLE_TIMEOUT_MS = 600;

export function useSortableList({
	keys,
	onReorder,
	disabled = false,
}: {
	keys: string[];
	onReorder: (from: number, to: number) => void;
	disabled?: boolean;
}) {
	const order = keys.join(" ");
	const scrollRef = useRef<HTMLElement | null>(null);
	const itemRefs = useRef<(HTMLElement | null)[]>([]);
	const refCallbacks = useRef<((element: HTMLElement | null) => void)[]>([]);
	const drag = useRef<Drag | null>(null);
	const frame = useRef<number | null>(null);
	const settledAt = useRef<string | null>(null);
	// The row is a link: without swallowing the click that ends the drag, reordering a playlist also navigates to it.
	const justDragged = useRef(false);

	// State rather than a ref: the rows have to re-render to follow, and writing transforms imperatively fights React over the same style attribute.
	const [state, setState] = useState<SortState | null>(null);

	// Cached per index: a fresh closure every render would detach and reattach every row's ref on every pointer move.
	const setItemRef = (index: number) => {
		refCallbacks.current[index] ??= (element: HTMLElement | null) => {
			itemRefs.current[index] = element;
		};
		return refCallbacks.current[index];
	};

	const stopAutoscroll = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
	}, []);

	useEffect(() => stopAutoscroll, [stopAutoscroll]);

	useEffect(() => {
		if (!state?.settled) return undefined;
		if (order !== settledAt.current) {
			setState(null);
			return undefined;
		}
		const timer = setTimeout(() => setState(null), SETTLE_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [state, order]);

	const autoscroll = (clientY: number) => {
		const scroller = scrollRef.current;
		if (!scroller) return;

		const step = autoscrollStep(scroller.getBoundingClientRect(), clientY);

		if (drag.current) drag.current.step = step;

		if (step === 0) {
			stopAutoscroll();
			return;
		}
		if (frame.current) return;

		const tick = () => {
			const before = scroller.scrollTop;
			scroller.scrollTop += drag.current?.step ?? 0;
			// Rows were measured in viewport coordinates, so scrolling moves them out from under the pointer.
			if (drag.current) drag.current.scrolled += scroller.scrollTop - before;
			const moved = scroller.scrollTop !== before;
			frame.current = moved ? requestAnimationFrame(tick) : null;
			if (moved && drag.current) {
				const offset = drag.current.offset + drag.current.scrolled;
				setState({
					...(drag.current as SortState),
					offset,
					to: targetFor(drag.current as SortState, offset),
				});
			}
		};

		frame.current = requestAnimationFrame(tick);
	};

	const onPointerMove = (event: ReactPointerEvent) => {
		const current = drag.current;
		if (!current) return;

		const travelled = event.clientY - current.startY;

		if (!current.active) {
			if (Math.abs(travelled) < current.threshold) return;
			current.active = true;
			if (!current.captured) {
				(event.currentTarget as HTMLElement).setPointerCapture(
					current.pointerId,
				);
				current.captured = true;
			}
			current.tops = itemRefs.current.slice(0, keys.length).map((element) => {
				const rect = (element as HTMLElement).getBoundingClientRect();
				return { top: rect.top, height: rect.height };
			});
		}

		current.offset = travelled;
		const offset = travelled + current.scrolled;
		setState({
			...(current as SortState),
			offset,
			to: targetFor(current as SortState, offset),
		});
		autoscroll(event.clientY);
	};

	const finish = (event?: ReactPointerEvent) => {
		const current = drag.current;
		drag.current = null;
		stopAutoscroll();

		if (!current?.active) {
			setState(null);
			return;
		}

		justDragged.current = true;

		const to =
			event?.type === "pointerup"
				? targetFor(current as SortState, current.offset + current.scrolled)
				: current.from;

		if (to === current.from) {
			setState(null);
			return;
		}

		// Held rather than cleared: the reorder is a round trip through the query cache, and letting go must not undo the drag while that runs.
		settledAt.current = order;
		setState({
			...(current as SortState),
			to,
			offset: landingOffset({ ...(current as SortState), to }),
			settled: true,
		});
		onReorder(current.from, to);
	};

	// A handle claims the pointer up front, being small enough to be left behind inside the threshold distance.
	// The row must not: capture retargets the compatibility mousedown and mouseup, so click fires on the row rather than on the link inside it and navigation silently stops working.
	const begin = (
		index: number,
		event: ReactPointerEvent,
		captureNow: boolean,
	) => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		// Cleared here rather than on a timer: a gesture that produced no click must not leave the guard armed for the next one.
		justDragged.current = false;
		if (captureNow)
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag.current = {
			from: index,
			to: index,
			startY: event.clientY,
			threshold: THRESHOLD_PX[event.pointerType] ?? THRESHOLD_PX.touch,
			pointerId: event.pointerId,
			captured: captureNow,
			offset: 0,
			scrolled: 0,
			step: 0,
			active: false,
			tops: null,
		};
	};

	// Mouse only: on touch the vertical axis is already the scroller's, so taking it needs something explicit to grab, which is what handleProps is.
	const dragProps = (index: number) =>
		disabled
			? {}
			: {
					onPointerDown: (event: ReactPointerEvent) => {
						if (event.pointerType !== "mouse") return;
						begin(index, event, false);
					},
					onPointerMove,
					onPointerUp: finish,
					onPointerCancel: finish,
					onClickCapture: (event: ReactMouseEvent) => {
						if (!justDragged.current) return;
						justDragged.current = false;
						event.preventDefault();
						event.stopPropagation();
					},
				};

	// Only starts the gesture; the move and release are tracked by dragProps on the row, which the events bubble to.
	const handleProps = (index: number) =>
		disabled
			? {}
			: {
					onPointerDown: (event: ReactPointerEvent) =>
						begin(index, event, true),
				};

	// No transform at rest: a translate3d of zero on every row would still hand each one its own compositing layer for the whole life of the list.
	const itemProps = (index: number) => ({
		ref: setItemRef(index),
		style: state
			? { transform: `translate3d(0, ${offsetFor(state, index)}px, 0)` }
			: undefined,
		"data-dragging":
			state && !state.settled && state.from === index ? "true" : undefined,
		"data-settling":
			state && (state.settled || state.from !== index) ? "true" : undefined,
	});

	return {
		scrollRef,
		itemProps,
		dragProps,
		handleProps,
		isDragging: state !== null && !state.settled,
		draggingIndex: state?.from ?? null,
	};
}
