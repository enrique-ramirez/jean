import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

import { autoscrollStep, gapAt } from "@/shared/lib/dragGeometry";
import { subscribers } from "@/shared/lib/store";

export interface DragPayload<T = unknown> {
	items: T;
	label: string;
	count: number;
	within?: string;
	origin?: number;
	held?: readonly number[];
}

export interface DragState {
	isDragging: boolean;
	over: string | null;
	at: number | null;
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

const THRESHOLD_PX: Record<string, number> = { mouse: 5, touch: 8 };
const GHOST_OFFSET = { x: 18, y: 16 };

const IDLE: DragState = {
	isDragging: false,
	over: null,
	at: null,
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
	useSyncExternalStore(listeners.subscribe, snapshot);

export const setGhostElement = (element: HTMLElement | null) => {
	ghostElement = element;
};

const setDocumentDragging = (on: boolean) => {
	document.body.style.userSelect = on ? "none" : "";
	document.body.style.cursor = on ? "grabbing" : "";
};

const placeGhost = (x: number, y: number) => {
	if (!ghostElement) return;
	ghostElement.style.transform = `translate3d(${x + GHOST_OFFSET.x}px, ${y + GHOST_OFFSET.y}px, 0)`;
};

let shiftedRows = new Map<HTMLElement, number>();

const rowGapUnder = (y: number, list: HTMLElement) => {
	for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
		const slot = (row.parentElement as HTMLElement).getBoundingClientRect();
		if (y >= slot.top && y < slot.bottom)
			return gapAt(slot, Number(row.dataset.row), y);
	}
	return null;
};

const spanOf = (element: HTMLElement) => {
	const start = Number(element.dataset.spanStart);
	return { start, end: start + Number(element.dataset.spanCount) };
};

const spanGapUnder = (y: number, list: HTMLElement) => {
	for (const element of list.querySelectorAll<HTMLElement>(
		"[data-span-start]",
	)) {
		const box = element.getBoundingClientRect();
		if (y < box.top || y >= box.bottom) continue;
		const { start, end } = spanOf(element);
		return y > box.top + box.height / 2 ? end : start;
	}
	return null;
};

const isSpanList = (list: HTMLElement) => list.dataset.dropSpans !== undefined;

const targetUnder = (
	x: number,
	y: number,
	payload: DragPayload,
	canDrop?: (id: string) => boolean,
) => {
	const element = document
		.elementFromPoint(x, y)
		?.closest<HTMLElement>("[data-drop-target]");
	const id = element?.dataset.dropTarget;
	if (!element || !id) return null;
	if (payload.within !== undefined && id !== payload.within) return null;
	if (canDrop && !canDrop(id)) return null;

	const refusal = element.dataset.dropRefuses || null;
	if (element.dataset.dropRows === undefined)
		return { id, refusal, at: null, list: null };

	const at = isSpanList(element)
		? spanGapUnder(y, element)
		: rowGapUnder(y, element);
	return at === null ? null : { id, refusal, at, list: element };
};

let marked: HTMLElement | null = null;
let liftedRows = new Set<HTMLElement>();

type Line = { element: HTMLElement; side: "before" | "after" } | null;

const rowLine = (
	list: HTMLElement,
	at: number,
	mounted: HTMLElement[],
): Line => {
	const rowAt = Math.min(at, Number(list.dataset.dropRows) - 1);
	const element = mounted.find((el) => Number(el.dataset.row) === rowAt);
	return element ? { element, side: at === rowAt ? "before" : "after" } : null;
};

const spanLine = (list: HTMLElement, at: number): Line => {
	const spans = Array.from(
		list.querySelectorAll<HTMLElement>("[data-span-start]"),
	);
	const opening = spans.find((el) => spanOf(el).start === at);
	if (opening) return { element: opening, side: "before" };
	const closing = spans.find((el) => spanOf(el).end === at);
	return closing ? { element: closing, side: "after" } : null;
};

const markInsertion = (
	list: HTMLElement | null,
	at: number | null,
	payload: DragPayload | undefined,
) => {
	const origin = payload?.origin;
	const mounted = list
		? Array.from(list.querySelectorAll<HTMLElement>("[data-row]"))
		: [];
	const line =
		list === null || at === null
			? null
			: isSpanList(list)
				? spanLine(list, at)
				: rowLine(list, at, mounted);

	if (marked && marked !== line?.element)
		marked.removeAttribute("data-drop-line");
	marked = line?.element ?? null;
	line?.element.setAttribute("data-drop-line", line.side);

	const height = mounted[0]?.getBoundingClientRect().height ?? 0;
	const shifts = new Map<HTMLElement, number>();
	if (at !== null && origin !== undefined)
		for (const el of mounted) {
			const index = Number(el.dataset.row);
			if (at > origin && index > origin && index < at) shifts.set(el, -height);
			if (at <= origin && index >= at && index < origin) shifts.set(el, height);
		}

	for (const el of shiftedRows.keys())
		if (!shifts.has(el)) el.style.removeProperty("transform");
	for (const [el, by] of shifts) el.style.transform = `translateY(${by}px)`;
	shiftedRows = shifts;

	const lifted = new Set(
		mounted.filter((el) => payload?.held?.includes(Number(el.dataset.row))),
	);
	for (const el of liftedRows)
		if (!lifted.has(el)) el.removeAttribute("data-dragging");
	for (const el of lifted) el.setAttribute("data-dragging", "");
	liftedRows = lifted;
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
	onDrop: (over: string, payload: DragPayload<T>, at: number | null) => void;
	disabled?: boolean;
}) {
	const gesture = useRef<Gesture | null>(null);
	const frame = useRef<number | null>(null);
	const dragged = useRef(false);

	const latest = useRef({ getPayload, canDrop, onDrop, disabled });
	latest.current = { getPayload, canDrop, onDrop, disabled };

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
		markInsertion(null, null, undefined);
		publish(IDLE);
	}, []);

	useEffect(() => teardown, [teardown]);

	const tick = useCallback(() => {
		const current = gesture.current;
		if (!current?.started) return;

		const { x, y } = current.pointer;
		placeGhost(x, y);
		autoscroll(x, y);

		const found = targetUnder(x, y, current.payload, latest.current.canDrop);
		const over = found?.id ?? null;
		const refusal = found?.refusal ?? null;
		const at = found?.at ?? null;
		markInsertion(found?.list ?? null, at, current.payload);
		if (over !== state.over || refusal !== state.refusal || at !== state.at)
			publish({ ...state, over, refusal, at });

		frame.current = requestAnimationFrame(tick);
	}, []);

	const begin = useCallback(
		(event: ReactPointerEvent, fromHandle: boolean) => {
			if (latest.current.disabled || event.button !== 0) return;
			if ((event.pointerType === "mouse") === fromHandle) return;

			teardown();
			dragged.current = false;

			const payload = latest.current.getPayload(event);
			if (!payload) return;
			const threshold = THRESHOLD_PX[event.pointerType] ?? THRESHOLD_PX.touch;

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
					) < threshold
				)
					return;

				current.started = true;
				dragged.current = true;
				setDocumentDragging(true);
				placeGhost(current.pointer.x, current.pointer.y);
				publish({
					isDragging: true,
					over: null,
					at: null,
					count: payload.count,
					label: payload.label,
					refusal: null,
				});
				frame.current = requestAnimationFrame(tick);
			};

			current.onUp = () => {
				const { started } = current;
				const { over, at } = state;
				const refused = state.refusal !== null;
				teardown();
				if (started && over && !refused)
					latest.current.onDrop(over, payload, at);
			};

			current.onCancel = teardown;

			gesture.current = current;
			window.addEventListener("pointermove", current.onMove);
			window.addEventListener("pointerup", current.onUp);
			window.addEventListener("pointercancel", current.onCancel);
		},
		[teardown, tick],
	);

	const dragProps = useMemo(
		() => ({
			onPointerDown: (event: ReactPointerEvent) => begin(event, false),
		}),
		[begin],
	);
	const handleProps = useMemo(
		() => ({
			onPointerDown: (event: ReactPointerEvent) => begin(event, true),
		}),
		[begin],
	);

	return { dragProps, handleProps, didDrag: () => dragged.current };
}
