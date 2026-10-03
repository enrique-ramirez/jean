import { type RefObject, useEffect } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusableIn = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) => element.getClientRects().length > 0,
	);

export function useTabTrap(
	container: RefObject<HTMLElement | null>,
	isActive = true,
) {
	useEffect(() => {
		if (!isActive) return undefined;

		const onKeyDown = (event: KeyboardEvent) => {
			const root = container.current;
			if (event.key !== "Tab" || !root) return;
			const over = (event.target as Element | null)?.closest(
				'[role="alertdialog"]',
			);
			if (over && over !== root) return;
			const stops = focusableIn(root);
			if (stops.length === 0) return;

			const at = stops.indexOf(document.activeElement as HTMLElement);
			const by = event.shiftKey ? -1 : 1;
			const next =
				at < 0
					? stops[event.shiftKey ? stops.length - 1 : 0]
					: stops[(at + by + stops.length) % stops.length];
			event.preventDefault();
			next?.focus();
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [container, isActive]);
}
