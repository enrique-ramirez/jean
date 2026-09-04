import { useEffect } from "react";

// A field owns Escape while it holds the caret: cancelling a rename and clearing the search field are both this key, and a capture listener runs before either of them.
const isTyping = (target: EventTarget | null) => {
	const element = target as HTMLElement | null;
	return (
		element?.tagName === "INPUT" ||
		element?.tagName === "TEXTAREA" ||
		element?.isContentEditable === true
	);
};

/** Escape, taken on the way down and stopped there. The playlist scope binds it to clearing a selection and stays mounted under every layer this screen opens, so a bubbling handler arrives second and clears a selection nobody could see. Pass `null` to stand down: capture beats every overlay above, so a layer that is no longer the front one has to say so. */
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
