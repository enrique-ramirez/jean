import { type TouchEvent as ReactTouchEvent, useRef } from "react";

import { scrollParentOf } from "@/shared/lib/scrollParent";

/**
 * A directional flick, on a surface that also has to scroll.
 *
 * Deliberately not built on `useDragFraction` or `useSortableList`: those track
 * a value or a position for the length of a drag, and this only has to answer
 * one question at the end -- which way, if any. Nothing follows the finger, so
 * there is nothing to render per frame and no pointer capture to take.
 *
 * **Touch events, not pointer events, and that is the whole design.** The
 * browser cancels the pointer stream the moment it claims a gesture for
 * scrolling -- *measured*, a downward flick inside a scrollable panel arrives as
 * `pointercancel` and never a `pointerup`, so a pointer-based version can only
 * ever see gestures on regions that do not scroll. Touch events keep firing
 * through a scroll, which is what lets one handler cover the whole surface.
 *
 * Touch only, for the same reason only a mouse drags a row: a mouse has a wheel
 * and a keyboard beside it, and claiming its drags would take the gesture that
 * selects text.
 */
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
		// Whether the thing under the finger had anywhere to scroll *up* to when
		// the gesture began. See `onTouchEnd`.
		wasAtTop: boolean;
	} | null>(null);

	return {
		onTouchStart: (event: ReactTouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;

			// Bounded by the surface this handler is attached to. Unbounded, a
			// gesture starting on the header walks straight past the screen and
			// finds the *track list* scrolling behind it -- which, mid-list, reports
			// "not at the top" and silently refuses to dismiss.
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

			// A slow drag is a scroll that happened to end somewhere else. Only a
			// flick is an instruction.
			if (event.timeStamp - start.at > 600) return;

			// The dominant axis wins outright rather than both firing: a diagonal
			// flick that dismissed the screen *and* changed tab would be two things
			// nobody asked for.
			if (Math.abs(dx) > Math.abs(dy)) {
				if (dx <= -distance) onLeft?.();
				else if (dx >= distance) onRight?.();
				return;
			}

			if (dy <= -distance) {
				onUp?.();
				return;
			}

			// Down dismisses only from the top of whatever was under the finger,
			// which is the rule every sheet that does this uses. Pulling down inside
			// a lyric you are halfway through means "scroll back up" and nothing
			// else; pulling down again once there is no further up to go means
			// "close". Restricting it by *region* instead -- the header and the
			// artwork only -- was the first attempt, and it left the tab you are
			// most likely to be reading as the one tab you could not swipe away.
			if (dy >= distance && start.wasAtTop) onDown?.();
		},

		onTouchCancel: () => {
			from.current = null;
		},
	};
}
