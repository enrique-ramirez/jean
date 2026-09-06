import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useRef,
	useState,
} from "react";

import { clamp } from "@/shared/lib/math";

// Pressing and moving starts a text selection, and dragging a selection is a native drag: the browser
// then follows the pointer with a snapshot of the control instead of moving the thumb. On touch, the
// browser keeps the gesture for panning without `touch-action`; capture does not save this, and
// `touch-action` intersects down the tree, so it belongs on the track itself.
const GRABBABLE = Object.freeze({
	userSelect: "none",
	WebkitUserSelect: "none",
	WebkitUserDrag: "none",
	touchAction: "none",
	WebkitTouchCallout: "none",
});

export function useDragFraction({
	onDrag,
	onCommit,
	disabled = false,
	orientation = "horizontal",
}: {
	onDrag?: (fraction: number) => void;
	onCommit?: (fraction: number) => void;
	disabled?: boolean;
	orientation?: "horizontal" | "vertical";
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [fraction, setFraction] = useState<number | null>(null);

	const read = useCallback(
		(event: ReactPointerEvent) => {
			const rect = (ref.current as HTMLElement).getBoundingClientRect();
			return orientation === "vertical"
				? clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
				: clamp((event.clientX - rect.left) / rect.width, 0, 1);
		},
		[orientation],
	);

	const handlers = {
		style: GRABBABLE,
		// `useSwipe` skips anything under this mark, or dragging a fader down also dismisses the screen
		// behind it.
		"data-owns-touch": "",

		onDragStart: (event: { preventDefault: () => void }) =>
			event.preventDefault(),

		onPointerDown: (event: ReactPointerEvent) => {
			if (disabled) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			const next = read(event);
			setFraction(next);
			onDrag?.(next);
		},
		onPointerMove: (event: ReactPointerEvent) => {
			if (fraction === null) return;
			const next = read(event);
			setFraction(next);
			onDrag?.(next);
		},
		onPointerUp: (event: ReactPointerEvent) => {
			if (fraction === null) return;
			event.currentTarget.releasePointerCapture(event.pointerId);
			onCommit?.(read(event));
			setFraction(null);
		},
		onPointerCancel: () => setFraction(null),
	};

	return { ref, fraction, isDragging: fraction !== null, handlers };
}
