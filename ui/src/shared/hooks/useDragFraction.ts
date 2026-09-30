import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useRef,
	useState,
} from "react";

import { clamp } from "@/shared/lib/math";

const GRABBABLE = Object.freeze({
	userSelect: "none",
	WebkitUserSelect: "none",
	WebkitUserDrag: "none",
	touchAction: "none",
	WebkitTouchCallout: "none",
});

export const ownsTouch = (target: EventTarget) =>
	(target as Element).closest("[data-owns-touch]") !== null;

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
		// Without the mark, dragging a fader down also dismisses the screen behind it.
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
			if (fraction === null || disabled) return;
			const next = read(event);
			setFraction(next);
			onDrag?.(next);
		},
		onPointerUp: (event: ReactPointerEvent) => {
			if (fraction === null) return;
			event.currentTarget.releasePointerCapture(event.pointerId);
			setFraction(null);
			if (disabled) return;
			onCommit?.(read(event));
		},
		onPointerCancel: () => setFraction(null),
	};

	return { ref, fraction, isDragging: fraction !== null, handlers };
}
