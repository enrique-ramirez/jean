import { useEffect, useRef } from "react";

// Closes a popover on outside pointer-down or Escape. The returned ref goes on the containing element, trigger included, so clicking the trigger again toggles rather than closing and reopening.
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
	isOpen: boolean,
	onDismiss: () => void,
	{
		// For a trigger that cannot sit inside the ref -- the queue's is in the status bar, a panel away. Without it the press closes and the click reopens, so the button stops closing what it opened.
		ignore = "",
		// Off for a surface that leaves the app behind it live: taking Escape without claiming the keyboard leaves every layer under it taking the same keystroke. See `shared/keyboard/CLAUDE.md`.
		onEscape = true,
	}: { ignore?: string; onEscape?: boolean } = {},
) {
	const ref = useRef<T | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Element;
			if (ignore && target.closest?.(ignore)) return;
			if (!ref.current?.contains(target)) onDismiss();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onDismiss();
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		if (onEscape) document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [isOpen, onDismiss, ignore, onEscape]);

	return ref;
}
