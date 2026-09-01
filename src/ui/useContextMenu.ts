import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useState,
} from "react";

import { type Point, useLongPress } from "../hooks/useLongPress";

// One anchor, three ways of asking for it: right-click, press-and-hold, and the
// Menu key. `<ActionMenu>` never learns which one happened.
//
// Spread `triggerProps` onto whatever the menu belongs to. It carries a `style`
// (see useLongPress) so merge rather than overwrite if the element has its own.
export function useContextMenu({ disabled = false } = {}) {
	const [anchor, setAnchor] = useState<Point | null>(null);

	const openAt = useCallback((point: Point) => setAnchor(point), []);
	const close = useCallback(() => setAnchor(null), []);

	const longPress = useLongPress(openAt, { enabled: !disabled });

	const onContextMenu = (event: ReactMouseEvent) => {
		if (disabled) return;
		event.preventDefault();

		// Keyboard invocation -- the Menu key, Shift+F10 -- reports no coordinates.
		// Anchor to the element instead, so the menu opens under the focus ring
		// rather than in the top-left corner of the window.
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
