import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";

// Dragging out of one scroll container and onto a target in another.
//
// Deliberately not built on useSortableList: there the dragged element stays
// mounted and the drop is arithmetic. Here the source row can be unmounted by
// the virtualiser mid-gesture and the target is elsewhere in the tree, so the
// drop is hit-tested against the document and a ghost follows the pointer.
//
// No pointer capture, here of all places: capture retargets every later event to
// the capturing element, and the natural one is the scroll container -- an
// ancestor of the rows, so a handler on a descendant would never fire again.

// What a row hands over when a drag starts on it: the refs being dragged, and
// what the ghost should say about them.
export interface DragPayload<T = unknown> {
	items: T;
	label: string;
	count: number;
}

// Only coarse facts, because everything subscribes to this and nothing may
// re-render per frame because of it.
export interface DragState {
	isDragging: boolean;
	over: string | null;
	count: number;
	label: string | null;
}

// One in-flight gesture. The window listeners are held on it so teardown can
// remove exactly the ones it added.
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
const AUTOSCROLL_ZONE_PX = 52;
const AUTOSCROLL_MAX_PX = 13;
// Below and right of the cursor, so the ghost never covers the row the pointer
// is actually over -- which is the row being hit-tested.
const GHOST_OFFSET = { x: 18, y: 16 };

const IDLE: DragState = {
	isDragging: false,
	over: null,
	count: 0,
	label: null,
};

let state = IDLE;
let ghostElement: HTMLElement | null = null;
const listeners = new Set<() => void>();

const publish = (next: DragState) => {
	state = next;
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

const snapshot = () => state;

export const useDragState = () =>
	useSyncExternalStore(subscribe, snapshot, snapshot);

// Held outside React because it is written every frame. See the note above.
export const setGhostElement = (element: HTMLElement | null) => {
	ghostElement = element;
};

// A drag that started somewhere with user-select: none can still select text it
// passes over, so the whole document is held still for the gesture.
const setDocumentDragging = (on: boolean) => {
	document.body.style.userSelect = on ? "none" : "";
	document.body.style.cursor = on ? "grabbing" : "";
};

const placeGhost = (x: number, y: number) => {
	if (!ghostElement) return;
	ghostElement.style.transform = `translate3d(${x + GHOST_OFFSET.x}px, ${y + GHOST_OFFSET.y}px, 0)`;
};

// The ghost is pointer-events: none, so it never shadows what is underneath.
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
	return id;
};

// Any marked scroller under the pointer follows the drag, so a target below the
// fold of a long sidebar is still reachable without letting go.
const autoscroll = (x: number, y: number) => {
	const scroller = document
		.elementFromPoint(x, y)
		?.closest<HTMLElement>("[data-drop-scroller]");
	if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;

	const rect = scroller.getBoundingClientRect();
	const above = y - rect.top;
	const below = rect.bottom - y;

	if (above < AUTOSCROLL_ZONE_PX) {
		scroller.scrollTop -= AUTOSCROLL_MAX_PX * (1 - above / AUTOSCROLL_ZONE_PX);
	} else if (below < AUTOSCROLL_ZONE_PX) {
		scroller.scrollTop += AUTOSCROLL_MAX_PX * (1 - below / AUTOSCROLL_ZONE_PX);
	}
};

// `getPayload` returns { items, label, count } for the row the gesture started
// on, or null to leave the pointer alone. `canDrop` filters targets by id.
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
	// True from the moment a drag starts until the next pointer-down, so a caller
	// can tell a drag from a click after the fact -- selection has to know.
	const dragged = useRef(false);

	const latest = useRef({ getPayload, canDrop, onDrop });
	latest.current = { getPayload, canDrop, onDrop };

	const teardown = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		const held = gesture.current;
		if (held) {
			window.removeEventListener("pointermove", held.onMove);
			window.removeEventListener("pointerup", held.onUp);
			window.removeEventListener("pointercancel", held.onCancel);
		}
		gesture.current = null;
	}, []);

	useEffect(() => teardown, [teardown]);

	// Hit-testing on a frame rather than on the move event, so a target that
	// scrolls under a stationary pointer still arms.
	const tick = useCallback(() => {
		const current = gesture.current;
		if (!current?.started) return;

		const { x, y } = current.pointer;
		placeGhost(x, y);
		autoscroll(x, y);

		const over = targetUnder(x, y, latest.current.canDrop);
		if (over !== state.over) publish({ ...state, over });

		frame.current = requestAnimationFrame(tick);
	}, []);

	const onPointerDown = (event: ReactPointerEvent) => {
		// Touch is not a drag surface here: the sidebar is a drawer that covers the
		// list, so there is nothing to drag onto. The menu is the path there.
		if (disabled || event.pointerType !== "mouse" || event.button !== 0) return;

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
			// Placed before the first paint of the ghost, or it appears at the origin
			// for one frame before catching up.
			placeGhost(current.pointer.x, current.pointer.y);
			publish({
				isDragging: true,
				over: null,
				count: payload.count,
				label: payload.label,
			});
			frame.current = requestAnimationFrame(tick);
		};

		current.onUp = () => {
			const { started } = current;
			const over = state.over;
			teardown();
			if (!started) return;
			setDocumentDragging(false);
			publish(IDLE);
			if (over) latest.current.onDrop(over, payload);
		};

		current.onCancel = () => {
			const { started } = current;
			teardown();
			if (!started) return;
			setDocumentDragging(false);
			publish(IDLE);
		};

		gesture.current = current;
		window.addEventListener("pointermove", current.onMove);
		window.addEventListener("pointerup", current.onUp);
		window.addEventListener("pointercancel", current.onCancel);
	};

	return { dragProps: { onPointerDown }, didDrag: () => dragged.current };
}
