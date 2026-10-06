import { type RefObject, useEffect, useRef, useState } from "react";

import { AXIS_LOCK } from "@/shared/hooks/useSwipe";
import { scrollParentOf } from "@/shared/lib/scrollParent";

interface Touching {
	x: number;
	y: number;
	wasAtTop: boolean;
	isTheSheets: boolean | null;
}

const ownedInside = (target: Element, sheet: HTMLElement) => {
	const owner = target.closest("[data-owns-touch]");
	return owner !== null && sheet.contains(owner);
};

// Touch events rather than pointer events, for the reason `useSwipe` gives, and attached by hand:
// React registers `touchmove` passive, and a passive listener cannot stop the scroll. Chrome
// treats the first `touchmove` it dispatches as the gesture's verdict, so nothing is prevented
// before the drag is known to be the sheet's.
export function useSheetDrag(
	sheet: RefObject<HTMLElement | null>,
	onDismiss: () => void,
	distance: number,
): number {
	const [dragY, setDragY] = useState(0);
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;

	useEffect(() => {
		const element = sheet.current;
		if (!element) return;
		let touching: Touching | null = null;

		const onTouchStart = (event: TouchEvent) => {
			touching = null;
			const touch = event.touches[0];
			if (!touch || event.touches.length > 1) return;
			const target = event.target as Element;
			if (ownedInside(target, element)) return;
			const scroller = scrollParentOf(target, element);
			touching = {
				x: touch.clientX,
				y: touch.clientY,
				wasAtTop: !scroller || scroller.scrollTop <= 0,
				isTheSheets: null,
			};
		};

		const onTouchMove = (event: TouchEvent) => {
			const touch = event.touches[0];
			if (!touching || !touch) return;
			const dx = touch.clientX - touching.x;
			const dy = touch.clientY - touching.y;

			if (touching.isTheSheets === null) {
				if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
				touching.isTheSheets = dy > Math.abs(dx) && touching.wasAtTop;
				if (!touching.isTheSheets) {
					touching = null;
					return;
				}
			}

			if (event.cancelable) event.preventDefault();
			setDragY(Math.max(0, dy));
		};

		const onTouchEnd = (event: TouchEvent) => {
			const touch = event.changedTouches[0];
			const drag = touching;
			touching = null;
			if (!drag?.isTheSheets || !touch) return;
			if (touch.clientY - drag.y > distance) dismiss.current();
			else setDragY(0);
		};

		const onTouchCancel = () => {
			touching = null;
			setDragY(0);
		};

		element.addEventListener("touchstart", onTouchStart, { passive: true });
		element.addEventListener("touchmove", onTouchMove, { passive: false });
		element.addEventListener("touchend", onTouchEnd);
		element.addEventListener("touchcancel", onTouchCancel);
		return () => {
			element.removeEventListener("touchstart", onTouchStart);
			element.removeEventListener("touchmove", onTouchMove);
			element.removeEventListener("touchend", onTouchEnd);
			element.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [sheet, distance]);

	return dragY;
}
