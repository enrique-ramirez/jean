import { useEffect, useRef } from "react";

// Blink sends `click` after a touch whatever its `pointerdown` listeners did, so the tap that
// dismissed is caught at the window before anything under it can act. A touch that became a scroll
// ends in `pointercancel` and sends no `click`. Added while this press is still bubbling, a
// capturing `pointerdown` listener on the window first hears the next press.
function swallowNextClick() {
	const swallow = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		release();
	};
	const release = () => {
		window.removeEventListener("click", swallow, true);
		window.removeEventListener("pointercancel", release, true);
		window.removeEventListener("pointerdown", release, true);
	};
	window.addEventListener("click", swallow, true);
	window.addEventListener("pointercancel", release, true);
	window.addEventListener("pointerdown", release, true);
}

export function useDismissable<T extends HTMLElement = HTMLDivElement>(
	isOpen: boolean,
	onDismiss: () => void,
	{
		ignore = "",
		// Off for a surface that leaves the app behind it live: taking Escape without claiming the
		// keyboard leaves every layer underneath taking the same keystroke.
		onEscape = true,
		tapOutsideOnlyDismisses = false,
	}: {
		ignore?: string;
		onEscape?: boolean;
		tapOutsideOnlyDismisses?: boolean;
	} = {},
) {
	const ref = useRef<T | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Element;
			if (ignore && target.closest?.(ignore)) return;
			if (ref.current?.contains(target)) return;
			if (tapOutsideOnlyDismisses && event.pointerType !== "mouse")
				swallowNextClick();
			onDismiss();
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
	}, [isOpen, onDismiss, ignore, onEscape, tapOutsideOnlyDismisses]);

	return ref;
}
