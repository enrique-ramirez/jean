import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useLayoutEffect,
} from "react";
import { rovedIndex } from "@/shared/lib/rove";

type BeyondHandler = (context: {
	event: ReactKeyboardEvent;
	items: HTMLElement[];
	at: number;
}) => boolean | undefined;

const ITEMS =
	'[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

export const itemsIn = (
	container: HTMLElement | null | undefined,
): HTMLElement[] => [
	...(container?.querySelectorAll<HTMLElement>(ITEMS) ?? []),
];

// `isReady` is load-bearing: a popover is invisible for the frame it is measured in, and focusing an
// invisible element puts focus nowhere. A layout effect, so the cleanup runs while the panel is
// still in the DOM.
export function useFocusCapture(
	ref: RefObject<HTMLElement | null>,
	isReady = true,
	initialFocus?: string,
) {
	useLayoutEffect(() => {
		if (!isReady) return undefined;

		const panel = ref.current;
		if (!panel) return undefined;
		const previous = document.activeElement as HTMLElement | null;
		if (!panel.contains(previous))
			(
				(initialFocus && panel.querySelector<HTMLElement>(initialFocus)) ||
				panel
			).focus({ preventScroll: true });

		return () => {
			if (panel.contains(document.activeElement))
				previous?.focus?.({ preventScroll: true });
		};
	}, [ref, isReady, initialFocus]);
}

// Nothing typed at an open menu belongs to the app behind it: without the `stopPropagation` the
// arrows seek the player and space toggles playback mid-menu. Tab is the exception.
export function handleMenuKeys(
	event: ReactKeyboardEvent,
	{
		container,
		onEscape,
		beyond,
	}: {
		container: HTMLElement | null | undefined;
		onEscape: () => void;
		beyond?: BeyondHandler;
	},
) {
	event.stopPropagation();
	if (event.key === "Tab") return;

	if (event.key === "Escape") {
		onEscape();
		event.preventDefault();
		return;
	}

	const items = itemsIn(container);
	const at = items.indexOf(document.activeElement as HTMLElement);

	if (beyond?.({ event, items, at })) {
		event.preventDefault();
		return;
	}

	if (event.target instanceof HTMLInputElement) return;

	const next = rovedIndex(event.key, at, items.length, {
		wrap: true,
		ends: true,
	});
	if (next === null) return;

	items[next]?.focus();
	event.preventDefault();
}
