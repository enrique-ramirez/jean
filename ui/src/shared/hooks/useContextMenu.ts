import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useState,
} from "react";

import { type Point, useLongPress } from "./useLongPress";

const BESIDE_INSET_X = 16;
const BESIDE_OVERLAP_Y = 4;

// `triggerProps` carries a style from `useLongPress`, so an element with its own must merge rather
// than overwrite.
export function useContextMenu({ disabled = false } = {}) {
	const [anchor, setAnchor] = useState<Point | null>(null);

	const openAt = useCallback((point: Point) => setAnchor(point), []);
	const close = useCallback(() => setAnchor(null), []);

	const openBeside = useCallback(
		(element: HTMLElement) => {
			if (disabled) return;
			const rect = element.getBoundingClientRect();
			setAnchor({
				x: rect.left + BESIDE_INSET_X,
				y: rect.bottom - BESIDE_OVERLAP_Y,
			});
		},
		[disabled],
	);

	const longPress = useLongPress(openAt, { enabled: !disabled });

	const onContextMenu = (event: ReactMouseEvent) => {
		if (disabled) return;
		event.preventDefault();

		// The Menu key's `contextmenu` carries no coordinates.
		if (event.clientX === 0 && event.clientY === 0) {
			openBeside(event.currentTarget as HTMLElement);
			return;
		}

		openAt({ x: event.clientX, y: event.clientY });
	};

	return {
		isOpen: anchor !== null,
		anchor,
		openAt,
		openBeside,
		close,
		triggerProps: { ...longPress, onContextMenu },
	};
}
