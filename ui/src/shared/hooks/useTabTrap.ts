import { type RefObject, useLayoutEffect, useRef, useState } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusableIn = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) => element.getClientRects().length > 0,
	);

const trapStack: HTMLElement[] = [];

// A layout effect, so the cleanup runs while the container is still in the DOM and can tell whether
// focus is inside it.
export function useTabTrap(
	container: RefObject<HTMLElement | null>,
	initialFocus?: string,
) {
	// Read while rendering: React runs a child's `autoFocus` before any effect here, and it would be recorded instead.
	const [opener] = useState(() => document.activeElement as HTMLElement | null);
	const firstFocus = useRef(initialFocus);
	firstFocus.current = initialFocus;

	useLayoutEffect(() => {
		const root = container.current;
		if (!root) return undefined;

		const selector = firstFocus.current;
		if (!root.contains(document.activeElement))
			((selector && root.querySelector<HTMLElement>(selector)) || root).focus({
				preventScroll: true,
			});

		trapStack.push(root);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || trapStack[trapStack.length - 1] !== root)
				return;

			const stops = focusableIn(root);
			const at = stops.indexOf(document.activeElement as HTMLElement);
			const leaving = event.shiftKey ? at === 0 : at === stops.length - 1;
			if (at >= 0 && !leaving) return;

			event.preventDefault();
			const wrapsTo = event.shiftKey ? stops[stops.length - 1] : stops[0];
			(wrapsTo ?? root).focus({ preventScroll: true });
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			trapStack.splice(trapStack.indexOf(root), 1);
			const focused = document.activeElement;
			if (
				opener?.isConnected &&
				(root.contains(focused) || focused === document.body)
			)
				opener.focus({ preventScroll: true });
		};
	}, [container, opener]);
}
