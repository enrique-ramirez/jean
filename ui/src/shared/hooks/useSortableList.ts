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

interface SortState extends Drag {
	tops: RowBox[];
	settled?: boolean;
}

const THRESHOLD_PX: Record<string, number> = { mouse: 6, touch: 8 };
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
	const justDragged = useRef(false);

	// State rather than a ref: writing the transforms imperatively fights React over the same style
	// attribute.
	const [state, setState] = useState<SortState | null>(null);

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

		// Held rather than cleared: the reorder is a round trip through the query cache, and letting go
		// must not undo the drag while that runs.
		settledAt.current = order;
		setState({
			...(current as SortState),
			to,
			offset: landingOffset({ ...(current as SortState), to }),
			settled: true,
		});
		onReorder(current.from, to);
	};

	const begin = (
		index: number,
		event: ReactPointerEvent,
		captureNow: boolean,
	) => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		justDragged.current = false;
		// `setPointerCapture` retargets the compatibility `mousedown` and `mouseup`, and `click` goes to
		// their common ancestor, so capturing on a row sends a click meant for a button inside it to the
		// row.
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

	const handleProps = (index: number) =>
		disabled
			? {}
			: {
					onPointerDown: (event: ReactPointerEvent) =>
						begin(index, event, true),
				};

	// No transform at rest: a translate3d of zero still hands every row its own compositing layer, for
	// the whole life of the list.
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
