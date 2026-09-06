import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";

import { autoscrollStep } from "@/shared/lib/dragGeometry";
import { subscribers } from "@/shared/lib/store";

// No pointer capture: capture retargets every later event to the capturing element, and the natural
// one here is the scroll container, an ancestor of the rows, so a handler on a descendant would
// never fire again.

export interface DragPayload<T = unknown> {
	items: T;
	label: string;
	count: number;
}

export interface DragState {
	isDragging: boolean;
	over: string | null;
	count: number;
	label: string | null;
	refusal: string | null;
}

interface Gesture {
	startX: number;
	startY: number;
	pointer: { x: number; y: number };
	payload: DragPayload;
	started: boolean;
	onMove: (event: PointerEvent) => void;
	onUp: () => void;
	onCancel: () => void;
}

const THRESHOLD_PX = 5;
const GHOST_OFFSET = { x: 18, y: 16 };

const IDLE: DragState = {
	isDragging: false,
	over: null,
	count: 0,
	label: null,
	refusal: null,
};

let state = IDLE;
let ghostElement: HTMLElement | null = null;
const listeners = subscribers();

const publish = (next: DragState) => {
	state = next;
	listeners.notify();
};

const snapshot = () => state;

export const useDragState = () =>
	useSyncExternalStore(listeners.subscribe, snapshot, snapshot);

export const setGhostElement = (element: HTMLElement | null) => {
	ghostElement = element;
};

// A drag that started somewhere with `user-select: none` can still select text it passes over, so
// the whole document is held still for the gesture.
const setDocumentDragging = (on: boolean) => {
	document.body.style.userSelect = on ? "none" : "";
	document.body.style.cursor = on ? "grabbing" : "";
};

const placeGhost = (x: number, y: number) => {
	if (!ghostElement) return;
	ghostElement.style.transform = `translate3d(${x + GHOST_OFFSET.x}px, ${y + GHOST_OFFSET.y}px, 0)`;
};

const targetUnder = (
	x: number,
	y: number,
	canDrop?: (id: string) => boolean,
) => {
	const element = document
		.elementFromPoint(x, y)
		?.closest<HTMLElement>("[data-drop-target]");
	const id = element?.dataset.dropTarget;
	if (!id || (canDrop && !canDrop(id))) return null;
	return { id, refusal: element?.dataset.dropRefuses || null };
};

const autoscroll = (x: number, y: number) => {
	const scroller = document
		.elementFromPoint(x, y)
		?.closest<HTMLElement>("[data-drop-scroller]");
	if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;

	scroller.scrollTop += autoscrollStep(scroller.getBoundingClientRect(), y);
};

export function useDragSource<T = unknown>({
	getPayload,
	canDrop,
	onDrop,
	disabled = false,
}: {
	getPayload: (event: ReactPointerEvent) => DragPayload<T> | null;
	canDrop?: (id: string) => boolean;
	onDrop: (over: string, payload: DragPayload<T>) => void;
	disabled?: boolean;
}) {
	const gesture = useRef<Gesture | null>(null);
	const frame = useRef<number | null>(null);
	const dragged = useRef(false);

	const latest = useRef({ getPayload, canDrop, onDrop });
	latest.current = { getPayload, canDrop, onDrop };

	// A drag torn down without this leaves the document at `user-select: none` and the ghost on screen
	// for the rest of the session.
	const teardown = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		const held = gesture.current;
		gesture.current = null;
		if (!held) return;

		window.removeEventListener("pointermove", held.onMove);
		window.removeEventListener("pointerup", held.onUp);
		window.removeEventListener("pointercancel", held.onCancel);
		if (!held.started) return;

		setDocumentDragging(false);
		publish(IDLE);
	}, []);

	useEffect(() => teardown, [teardown]);

	// Hit-testing on a frame rather than on the move event, so a target that scrolls under a
	// stationary pointer still arms.
	const tick = useCallback(() => {
		const current = gesture.current;
		if (!current?.started) return;

		const { x, y } = current.pointer;
		placeGhost(x, y);
		autoscroll(x, y);

		const found = targetUnder(x, y, latest.current.canDrop);
		const over = found?.id ?? null;
		const refusal = found?.refusal ?? null;
		if (over !== state.over || refusal !== state.refusal)
			publish({ ...state, over, refusal });

		frame.current = requestAnimationFrame(tick);
	}, []);

	const onPointerDown = (event: ReactPointerEvent) => {
		if (disabled || event.pointerType !== "mouse" || event.button !== 0) return;

		// A gesture still in flight owns three window listeners whose references are about to become
		// unreachable, and teardown could never remove them again.
		teardown();
		dragged.current = false;

		const payload = latest.current.getPayload(event);
		if (!payload) return;

		const current: Gesture = {
			startX: event.clientX,
			startY: event.clientY,
			pointer: { x: event.clientX, y: event.clientY },
			payload: payload as DragPayload,
			started: false,
			onMove: () => {},
			onUp: () => {},
			onCancel: () => {},
		};

		current.onMove = (moveEvent) => {
			current.pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
			if (current.started) return;
			if (
				Math.hypot(
					moveEvent.clientX - current.startX,
					moveEvent.clientY - current.startY,
				) < THRESHOLD_PX
			)
				return;

			current.started = true;
			dragged.current = true;
			setDocumentDragging(true);
			placeGhost(current.pointer.x, current.pointer.y);
			publish({
				isDragging: true,
				over: null,
				count: payload.count,
				label: payload.label,
				refusal: null,
			});
			frame.current = requestAnimationFrame(tick);
		};

		current.onUp = () => {
			const { started } = current;
			const over = state.over;
			// Read before `teardown` clears the state.
			const refused = state.refusal !== null;
			teardown();
			if (started && over && !refused) latest.current.onDrop(over, payload);
		};

		current.onCancel = teardown;

		gesture.current = current;
		window.addEventListener("pointermove", current.onMove);
		window.addEventListener("pointerup", current.onUp);
		window.addEventListener("pointercancel", current.onCancel);
	};

	return { dragProps: { onPointerDown }, didDrag: () => dragged.current };
}
