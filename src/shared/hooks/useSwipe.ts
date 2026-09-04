import { type TouchEvent as ReactTouchEvent, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

// Longer than this and the gesture is a scroll that happened to end somewhere else, not an instruction.
const FLICK_MS = 600;

// Movement worth reading an axis off. Below it a finger is still settling and the dominant axis is noise.
const AXIS_LOCK = 8;

// A directional flick on a surface that also has to scroll.
// Touch events rather than pointer events: the browser cancels the pointer stream the moment it claims a gesture for scrolling, so a pointer-based version only ever sees gestures on regions that do not scroll.
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
	/** Live horizontal offset, for a surface that follows the finger. Giving this hands the horizontal axis over: `onLeft` and `onRight` are not called for a gesture it tracked, because the caller is deciding. */
	onDrag?: (dx: number) => void;
	onDragEnd?: (dx: number, wasFlick: boolean) => void;
	distance?: number;
}) {
	const from = useRef<{
		x: number;
		y: number;
		at: number;
		// Whether the thing under the finger had anywhere left to scroll, either way, when the gesture began. See onTouchEnd.
		wasAtTop: boolean;
		wasAtBottom: boolean;
		// Decided once, at the first movement worth reading, and held for the rest of the gesture. Null where nothing is tracking, which is what leaves every other caller on the original path.
		axis: "x" | "y" | null;
	} | null>(null);

	return {
		onTouchStart: (event: ReactTouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;

			// A fader, a scrubber or the popover one opens in has already claimed the axis: a drag down the volume track is not a flick at the screen behind it. Nothing is recorded, so the end of the gesture has nothing to read.
			if ((event.target as Element).closest("[data-owns-touch]")) return;

			// Bounded by the surface this handler is attached to: unbounded, a gesture starting on the header finds the track list scrolling behind it, which mid-list reports not at the top and silently refuses to dismiss.
			const scroller = scrollParentOf(
				event.target as Element,
				event.currentTarget,
			);
			from.current = {
				x: touch.clientX,
				y: touch.clientY,
				at: event.timeStamp,
				wasAtTop: !scroller || scroller.scrollTop <= 0,
				// A pixel of slack: a box scrolled to its end lands a fraction short of it, because row heights and the scrollport are both fractional.
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

			// A tracked gesture is the caller's to settle: it watched the whole drag and knows how far round it got, which is a question about the surface rather than about the finger.
			if (start.axis === "x") {
				onDragEnd?.(dx, wasFlick);
				return;
			}

			if (!wasFlick) return;

			// The dominant axis wins outright rather than both firing: a diagonal flick that dismissed the screen and changed tab would be two things nobody asked for.
			if (Math.abs(dx) > Math.abs(dy)) {
				if (dx <= -distance) onLeft?.();
				else if (dx >= distance) onRight?.();
				return;
			}

			// Each vertical direction fires only from the end of the scroll it would otherwise be: part-way through a scrollable region, pulling down means scroll up and nothing else, and pushing up means read on.
			if (dy <= -distance) {
				if (start.wasAtBottom) onUp?.();
				return;
			}

			if (dy >= distance && start.wasAtTop) onDown?.();
		},

		onTouchCancel: () => {
			// A tracked surface is sitting wherever the finger left it, so it has to be told even when the browser took the gesture away.
			if (from.current?.axis === "x") onDragEnd?.(0, false);
			from.current = null;
		},
	};
}
