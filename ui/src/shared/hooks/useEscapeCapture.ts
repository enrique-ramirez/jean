import { useEffect } from "react";

const isTyping = (target: EventTarget | null) => {
	const element = target as HTMLElement | null;
	return (
		element?.tagName === "INPUT" ||
		element?.tagName === "TEXTAREA" ||
		element?.isContentEditable === true
	);
};

// Escape, taken on the way down and stopped there. Pass `null` to stand down: capture beats every
// overlay above, so a layer that is no longer the front one has to say so.
export function useEscapeCapture(onEscape: (() => void) | null) {
	useEffect(() => {
		if (!onEscape) return undefined;

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || isTyping(event.target)) return;
			event.stopPropagation();
			onEscape();
		};

		window.addEventListener("keydown", onKey, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKey, { capture: true });
	}, [onEscape]);
}
