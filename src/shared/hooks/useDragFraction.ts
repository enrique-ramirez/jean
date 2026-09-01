import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useRef,
	useState,
} from "react";

import { clamp } from "@/shared/lib/math";

// Covers both ways a browser can decide a drag was meant for it rather than for
// the control.
//
// On a pointer, pressing and moving starts a text selection, and dragging a
// selection is a native drag -- so the browser paints a snapshot of the control
// and follows the pointer with that instead of moving the thumb.
//
// On touch, without `touch-action` the browser keeps the gesture for panning and
// stops sending moves the moment it decides the finger is scrolling. Capture
// does not save this -- it routes events that still exist -- and `touch-action`
// intersects down the tree, so it belongs on the track itself.
const GRABBABLE = Object.freeze({
	userSelect: "none",
	WebkitUserSelect: "none",
	WebkitUserDrag: "none",
	touchAction: "none",
	WebkitTouchCallout: "none",
});

// Pointer-drag along a horizontal track, as 0..1. While dragging, `fraction` is
// the pointer's position rather than the incoming value, or the thumb fights
// whatever the player last reported.
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

	// Vertical is inverted: the top of the track is the maximum, which is what
	// every physical fader does and what people expect from a volume column.
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

		// Belt to the CSS braces: states the guarantee outright rather than leaving
		// it to hold as a consequence of nothing being selectable.
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
