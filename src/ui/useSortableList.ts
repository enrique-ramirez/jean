import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

// Where each row sat when the drag began, in viewport coordinates. Measured
// once, which is why rows of different heights need no special case.
interface RowBox {
	top: number;
	height: number;
}

// The gesture in progress. `tops` is null until it turns out to be a drag
// rather than a click, because measuring is what the threshold buys.
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

// What the rows are rendering. `settled` marks the window between letting go
// and the caller's `keys` actually changing, during which the transforms are
// deliberately held rather than cleared.
interface SortState extends Drag {
	tops: RowBox[];
	settled?: boolean;
}

// Reordering a short list by dragging it. Pointer events rather than HTML5
// drag-and-drop: one implementation covers mouse and touch, and the dragged row
// is a real element instead of a screenshot of one.
//
// Rows are measured once, on drag start -- a list you can reorder by hand is a
// list you can see all of -- which is also why variable heights need no special
// case: an item shifts by the gap between the two rows it swaps with.
//
// `keys` is the current order, as stable ids, and it is what tells the drop when
// it is over. The transforms are **held** at their landing positions until the
// caller has actually reordered: the reorder goes through the query cache, a
// microtask away at best, so clearing them on pointerup flicks the row back to
// where it started for a frame.

// Far enough that a click is never mistaken for a drag. Generous for a mouse on
// purpose: the row body is both the drag target and a navigation control, and a
// click that wanders should not quietly rewrite the order. Touch is stricter
// again -- a finger moves a few pixels just being lifted.
const THRESHOLD_PX: Record<string, number> = { mouse: 6, touch: 8 };
// How close to the edge of the scroller before it starts following the drag.
const AUTOSCROLL_ZONE_PX = 56;
const AUTOSCROLL_MAX_PX = 14;
// If the reorder never lands -- the player refused it -- stop holding the
// transforms rather than freezing the list in place.
const SETTLE_TIMEOUT_MS = 600;

// Where the dragged row ends up once the list is reordered. Going down it takes
// the slot the target row vacates, which has to be measured from that row's
// *bottom*: with rows of different heights the tops do not line up.
const landingOffset = ({
	tops,
	from,
	to,
}: {
	tops: RowBox[];
	from: number;
	to: number;
}) => {
	if (to > from)
		return tops[to].top + tops[to].height - tops[from].height - tops[from].top;
	return tops[to].top - tops[from].top;
};

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
	// A mouse drag that starts on the row ends with a click on the row, and the
	// row is a link. Without swallowing it, reordering a playlist also navigates
	// to it. The grip never had this problem: it is not inside the button.
	const justDragged = useRef(false);

	// Position is state, not a ref: the rows have to re-render to follow. It is
	// one small list, and the alternative -- writing transforms imperatively --
	// fights React over the same style attribute the drop then has to clear.
	const [state, setState] = useState<SortState | null>(null);

	// Cached per index. A fresh closure every render would detach and reattach
	// every row's ref on every pointer move.
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

	// Which index the dragged row would land on, compared against the midpoint of
	// each resting row -- so the swap happens when they visually cross rather
	// than when they merely touch.
	const targetFor = (
		{ tops, from }: { tops: RowBox[]; from: number },
		offset: number,
	) => {
		const centre = tops[from].top + offset + tops[from].height / 2;
		const crossed = (index: number) => tops[index].top + tops[index].height / 2;

		const above = tops.findIndex(
			(_, index) => index < from && centre < crossed(index),
		);
		if (above >= 0) return above;

		return tops.reduce(
			(target, _, index) =>
				index > from && centre > crossed(index) ? index : target,
			from,
		);
	};

	const autoscroll = (clientY: number) => {
		const scroller = scrollRef.current;
		if (!scroller) return;

		const rect = scroller.getBoundingClientRect();
		const above = clientY - rect.top;
		const below = rect.bottom - clientY;

		let step = 0;
		if (above < AUTOSCROLL_ZONE_PX)
			step = -AUTOSCROLL_MAX_PX * (1 - above / AUTOSCROLL_ZONE_PX);
		else if (below < AUTOSCROLL_ZONE_PX)
			step = AUTOSCROLL_MAX_PX * (1 - below / AUTOSCROLL_ZONE_PX);

		if (drag.current) drag.current.step = step;

		if (step === 0) {
			stopAutoscroll();
			return;
		}
		if (frame.current) return;

		const tick = () => {
			const before = scroller.scrollTop;
			scroller.scrollTop += drag.current?.step ?? 0;
			// The rows were measured in viewport coordinates, so scrolling moves them
			// out from under the pointer. Folding the scroll back into the offset
			// keeps the dragged row where the finger left it.
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

		// Held at the landing position rather than cleared. The reorder is a round
		// trip through the query cache, and letting go must not undo the drag for
		// the frame or two that takes.
		settledAt.current = order;
		setState({
			...(current as SortState),
			to,
			offset: landingOffset({ ...(current as SortState), to }),
			settled: true,
		});
		onReorder(current.from, to);
	};

	// `captureNow` is the difference between the two ways in. A handle is small
	// enough that a pointer can leave it inside the threshold distance and never
	// report the move that starts the drag, so it claims the pointer up front.
	//
	// The row must NOT. Capturing retargets the compatibility mousedown and
	// mouseup to the capturing element, so `click` fires on the row rather than
	// on the link inside it -- and clicking a playlist silently stops working.
	// It captures once the gesture is definitely a drag, by which point the click
	// is being swallowed anyway.
	const begin = (
		index: number,
		event: ReactPointerEvent,
		captureNow: boolean,
	) => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		// Cleared here rather than on a timer: a gesture that produced no click
		// must not leave the guard armed for the next one.
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

	// Dragging the row itself, which is the convention for a list of links and
	// needs no affordance to be found. Mouse only, and that is the whole reason
	// handleProps also exists: on touch the vertical axis is already the
	// scroller's, so taking it needs something explicit to grab.
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

	// An explicit grab target, for pointers that cannot use the row body. Only
	// starts the gesture -- the move and release are tracked by dragProps on the
	// row, which the events bubble to.
	const handleProps = (index: number) =>
		disabled
			? {}
			: {
					onPointerDown: (event: ReactPointerEvent) =>
						begin(index, event, true),
				};

	// What each row is doing right now, as a transform the caller can apply. The
	// dragged row follows the pointer; every row between where it started and
	// where it would land slides into the slot the one next to it just left.
	const offsetFor = (index: number) => {
		if (!state) return 0;
		const { from, to, offset, tops } = state;
		if (index === from) return offset;
		if (from < to && index > from && index <= to)
			return tops[index - 1].top - tops[index].top;
		if (from > to && index >= to && index < from)
			return tops[index + 1].top - tops[index].top;
		return 0;
	};

	// No transform at rest. A translate3d of zero on every row would still hand
	// each one its own compositing layer for the whole life of the list.
	const itemProps = (index: number) => ({
		ref: setItemRef(index),
		style: state
			? { transform: `translate3d(0, ${offsetFor(index)}px, 0)` }
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
