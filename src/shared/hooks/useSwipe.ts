import { type TouchEvent as ReactTouchEvent, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

const FLICK_MS = 600;
const AXIS_LOCK = 8;

// Touch events rather than pointer events: the browser cancels the pointer stream the moment it
// claims a gesture for scrolling, so a pointer-based version only sees gestures on regions that do
// not scroll.
export function useSwipe({
	onLeft,
	onRight,
	onUp,
	onDown,
	onDrag,
	onDragEnd,
	distance = 60,
}: {
	onLeft?: () => void;
	onRight?: () => void;
	onUp?: () => void;
	onDown?: () => void;
	// Giving this hands the horizontal axis over: `onLeft` and `onRight` do not fire for a gesture it
	// tracked.
	onDrag?: (dx: number) => void;
	onDragEnd?: (dx: number, wasFlick: boolean) => void;
	distance?: number;
}) {
	const from = useRef<{
		x: number;
		y: number;
		at: number;
		wasAtTop: boolean;
		wasAtBottom: boolean;
		axis: "x" | "y" | null;
	} | null>(null);

	return {
		onTouchStart: (event: ReactTouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;

			// A control that follows the finger has already claimed the axis. See `useDragFraction`.
			if ((event.target as Element).closest("[data-owns-touch]")) return;

			// Bounded by the surface this handler is on: unbounded, a gesture starting on the header finds
			// the list scrolling behind it, which mid-list reports not at the top and refuses to dismiss.
			const scroller = scrollParentOf(
				event.target as Element,
				event.currentTarget,
			);
			from.current = {
				x: touch.clientX,
				y: touch.clientY,
				at: event.timeStamp,
				wasAtTop: !scroller || scroller.scrollTop <= 0,
				// A pixel of slack: a box scrolled to its end lands a fraction short of it, row heights and
				// the scrollport both being fractional.
				wasAtBottom:
					!scroller ||
					scroller.scrollTop + scroller.clientHeight >=
						scroller.scrollHeight - 1,
				axis: null,
			};
		},

		onTouchMove: (event: ReactTouchEvent) => {
			const start = from.current;
			const touch = event.touches[0];
			if (!start || !touch || !onDrag) return;

			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;

			if (start.axis === null) {
				if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
				start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
			}

			if (start.axis === "x") onDrag(dx);
		},

		onTouchEnd: (event: ReactTouchEvent) => {
			const start = from.current;
			const touch = event.changedTouches[0];
			from.current = null;
			if (!start || !touch) return;

			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			const wasFlick = event.timeStamp - start.at <= FLICK_MS;

			if (start.axis === "x") {
				onDragEnd?.(dx, wasFlick);
				return;
			}

			if (!wasFlick) return;

			if (Math.abs(dx) > Math.abs(dy)) {
				if (dx <= -distance) onLeft?.();
				else if (dx >= distance) onRight?.();
				return;
			}

			if (dy <= -distance) {
				if (start.wasAtBottom) onUp?.();
				return;
			}

			if (dy >= distance && start.wasAtTop) onDown?.();
		},

		onTouchCancel: () => {
			if (from.current?.axis === "x") onDragEnd?.(0, false);
			from.current = null;
		},
	};
}
