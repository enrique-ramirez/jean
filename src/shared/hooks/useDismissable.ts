import { useEffect, useRef } from "react";

export function useDismissable<T extends HTMLElement = HTMLDivElement>(
	isOpen: boolean,
	onDismiss: () => void,
	{
		ignore = "",
		// Off for a surface that leaves the app behind it live: taking Escape without claiming the
		// keyboard leaves every layer underneath taking the same keystroke.
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
