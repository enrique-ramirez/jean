import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useState,
} from "react";

import { type Point, useLongPress } from "./useLongPress";

// `triggerProps` carries a style from `useLongPress`, so an element with its own must merge rather
// than overwrite.
export function useContextMenu({ disabled = false } = {}) {
	const [anchor, setAnchor] = useState<Point | null>(null);

	const openAt = useCallback((point: Point) => setAnchor(point), []);
	const close = useCallback(() => setAnchor(null), []);

	const longPress = useLongPress(openAt, { enabled: !disabled });

	const onContextMenu = (event: ReactMouseEvent) => {
		if (disabled) return;
		event.preventDefault();

		if (event.clientX === 0 && event.clientY === 0) {
			const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			openAt({ x: rect.left + 16, y: rect.bottom - 4 });
			return;
		}

		openAt({ x: event.clientX, y: event.clientY });
	};

	return {
		isOpen: anchor !== null,
		anchor,
		openAt,
		close,
		triggerProps: { ...longPress, onContextMenu },
	};
}
