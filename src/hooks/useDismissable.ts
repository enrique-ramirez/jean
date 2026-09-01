import { useEffect, useRef } from "react";

// Closes a popover on outside pointer-down or Escape. Returns the ref to put on
// the popover's containing element (trigger included, so clicking the trigger
// again toggles rather than closing-then-reopening).
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
	isOpen: boolean,
	onDismiss: () => void,
) {
	const ref = useRef<T | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		const onPointerDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) onDismiss();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onDismiss();
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [isOpen, onDismiss]);

	return ref;
}
