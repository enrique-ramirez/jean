import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useRef,
} from "react";
import type { TrackRows } from "./project";
import { targetsFrom } from "./trackTargets";
import type { useTrackDragSource } from "./useTrackDragSource";
import type { useTrackSelection } from "./useTrackSelection";

export function useRowPointer({
	rows,
	selection,
	trackDrag,
	play,
}: {
	rows: TrackRows;
	selection: ReturnType<typeof useTrackSelection>;
	trackDrag: ReturnType<typeof useTrackDragSource>;
	play: (position: number) => void;
}) {
	const { moveCursorTo } = selection;

	// Collapsing a multi-track selection on the way down would kill a drag of all of them, so the
	// collapse waits for the pointer to come up.
	const pendingCollapse = useRef<number | null>(null);

	const selectFromPointer = useCallback(
		(index: number, event: ReactPointerEvent) => {
			if (event.pointerType !== "mouse") return;
			const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey;
			if (
				plain &&
				selection.selection.has(index) &&
				selection.selection.size > 1
			) {
				pendingCollapse.current = index;
				return;
			}
			selection.selectFromEvent(index, event);
		},
		[selection],
	);

	const resolveCollapse = useCallback(() => {
		const pending = pendingCollapse.current;
		pendingCollapse.current = null;
		if (pending !== null && !trackDrag.didDrag()) moveCursorTo(pending);
	}, [moveCursorTo, trackDrag]);

	// Recorded on the way down rather than read off the click: `click` is a PointerEvent in Chromium
	// and Safari but a plain MouseEvent in Firefox, where every desktop click would read as a tap.
	const pointerType = useRef("mouse");

	// A browser counts a click toward the next one's `detail` even when something stopped it before
	// it reached this list, so a repeat is also one whose press follows the last click this list heard.
	const pressesSinceClick = useRef(0);

	const aimedIndex = useCallback(
		(event: ReactMouseEvent) =>
			targetsFrom(event, rows.length, selection.selection)?.index ?? null,
		[rows.length, selection.selection],
	);

	// A touch selects and plays on `click` rather than on the press or `pointerup`: the browser
	// withholds it when the gesture turns out to be a scroll.
	const onClick = useCallback(
		(event: ReactMouseEvent) => {
			const isRepeat = event.detail > 1 && pressesSinceClick.current === 1;
			pressesSinceClick.current = 0;
			if (pointerType.current === "mouse") return;
			const index = aimedIndex(event);
			if (index === null) return;
			selection.selectFromEvent(index, event);
			if (!isRepeat) play(index);
		},
		[aimedIndex, selection, play],
	);

	const onDoubleClick = useCallback(
		(event: ReactMouseEvent) => {
			if (pointerType.current !== "mouse") return;
			const index = aimedIndex(event);
			if (index !== null) play(index);
		},
		[aimedIndex, play],
	);

	return {
		selectFromPointer,
		rowHandlers: {
			onPointerDown: (event: ReactPointerEvent) => {
				pointerType.current = event.pointerType;
				pressesSinceClick.current += 1;
			},
			onPointerUp: resolveCollapse,
			onClick,
			onDoubleClick,
		},
	};
}
