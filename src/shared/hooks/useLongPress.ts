import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
} from "react";

export interface Point {
	x: number;
	y: number;
}

const HOLD_MS = 420;
const SLOP_PX = 10;
const ECHO_MS = 700;

// Spread `style` onto the pressable element, or iOS draws its own selection callout over the menu.
const PRESSABLE = Object.freeze({
	WebkitTouchCallout: "none",
	WebkitUserSelect: "none",
	userSelect: "none",
});

export function useLongPress(
	onLongPress: (point: Point) => void,
	{
		enabled = true,
		holdMs = HOLD_MS,
	}: { enabled?: boolean; holdMs?: number } = {},
) {
	const timer = useRef<number | null>(null);
	const echoTimer = useRef<number | null>(null);
	const origin = useRef<Point | null>(null);
	const justFired = useRef(false);
	const latest = useRef(onLongPress);
	latest.current = onLongPress;

	const cancel = useCallback(() => {
		clearTimeout(timer.current ?? undefined);
		timer.current = null;
		origin.current = null;
	}, []);

	useEffect(
		() => () => {
			clearTimeout(timer.current ?? undefined);
			clearTimeout(echoTimer.current ?? undefined);
		},
		[],
	);

	const onPointerDown = (event: ReactPointerEvent) => {
		if (!enabled || event.pointerType === "mouse" || !event.isPrimary) return;

		cancel();
		justFired.current = false;
		const point = { x: event.clientX, y: event.clientY };
		origin.current = point;

		timer.current = setTimeout(() => {
			timer.current = null;
			origin.current = null;
			justFired.current = true;
			// Time-boxed rather than cleared by whichever echo arrives: Android suppresses the click once
			// it has fired contextmenu and iOS sends the click and no contextmenu, so waiting for a
			// specific one leaves the guard stuck on.
			clearTimeout(echoTimer.current ?? undefined);
			echoTimer.current = setTimeout(() => {
				justFired.current = false;
			}, ECHO_MS);
			navigator.vibrate?.(8);
			latest.current(point);
		}, holdMs);
	};

	const onPointerMove = (event: ReactPointerEvent) => {
		if (!origin.current) return;
		const dx = event.clientX - origin.current.x;
		const dy = event.clientY - origin.current.y;
		if (Math.hypot(dx, dy) > SLOP_PX) cancel();
	};

	return {
		style: PRESSABLE,
		onPointerDown,
		onPointerMove,
		onPointerUp: cancel,
		onPointerCancel: cancel,
		onPointerLeave: cancel,

		onClickCapture: (event: ReactMouseEvent) => {
			if (!justFired.current) return;
			event.preventDefault();
			event.stopPropagation();
		},

		// Android fires a real contextmenu part-way into a hold, which arrives just after this one and
		// would reopen the menu somewhere else.
		onContextMenuCapture: (event: ReactMouseEvent) => {
			if (!justFired.current) return;
			event.preventDefault();
			event.stopPropagation();
		},
	};
}
