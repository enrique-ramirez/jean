import { type TouchEvent as ReactTouchEvent, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

// Longer than this and the gesture is a scroll that happened to end somewhere else, not an instruction.
const FLICK_MS = 600;

// A directional flick on a surface that also has to scroll.
// Touch events rather than pointer events: the browser cancels the pointer stream the moment it claims a gesture for scrolling, so a pointer-based version only ever sees gestures on regions that do not scroll.
export function useSwipe({
	onLeft,
	onRight,
	onUp,
	onDown,
	distance = 60,
}: {
	onLeft?: () => void;
	onRight?: () => void;
	onUp?: () => void;
	onDown?: () => void;
	distance?: number;
}) {
	const from = useRef<{
		x: number;
		y: number;
		at: number;
		// Whether the thing under the finger had anywhere to scroll up to when the gesture began. See onTouchEnd.
		wasAtTop: boolean;
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
			};
		},

		onTouchEnd: (event: ReactTouchEvent) => {
			const start = from.current;
			const touch = event.changedTouches[0];
			from.current = null;
			if (!start || !touch) return;

			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;

			if (event.timeStamp - start.at > FLICK_MS) return;

			// The dominant axis wins outright rather than both firing: a diagonal flick that dismissed the screen and changed tab would be two things nobody asked for.
			if (Math.abs(dx) > Math.abs(dy)) {
				if (dx <= -distance) onLeft?.();
				else if (dx >= distance) onRight?.();
				return;
			}

			if (dy <= -distance) {
				onUp?.();
				return;
			}

			// Down dismisses only from the top of whatever was under the finger: part-way through a scrollable region, pulling down means scroll up and nothing else.
			if (dy >= distance && start.wasAtTop) onDown?.();
		},

		onTouchCancel: () => {
			from.current = null;
		},
	};
}
