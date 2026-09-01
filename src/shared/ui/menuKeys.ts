import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useLayoutEffect,
} from "react";

// What a surface adds on top of the shared roving behaviour. Taking the key
// means returning true.
type BeyondHandler = (context: {
	event: ReactKeyboardEvent;
	items: HTMLElement[];
	at: number;
}) => boolean | undefined;

// Shared by both menu surfaces, so the two cannot answer the same key
// differently. They already had: Escape closed the dropdown *and* cleared the
// track selection behind it.

// Both roles, because a checkbox in a menu is still a row you arrow onto.
const ITEMS =
	'[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

const itemsIn = (container: HTMLElement | null | undefined): HTMLElement[] => [
	...(container?.querySelectorAll<HTMLElement>(ITEMS) ?? []),
];

// Wrapping, and -1 is the last one.
const ROVE: Record<string, (at: number) => number> = {
	ArrowDown: (at) => at + 1,
	ArrowUp: (at) => (at < 0 ? -1 : at - 1),
	Home: () => 0,
	End: () => -1,
};

// Focus returns on close only if the panel still holds it: an action may send
// focus somewhere deliberately, and must not have it taken back.
//
// `isReady` is load-bearing -- a popover is invisible for the frame it is
// measured in, and focusing an invisible element puts focus nowhere. A layout
// effect, so the cleanup runs while the panel is still in the DOM.
export function useFocusCapture(
	ref: RefObject<HTMLElement | null>,
	isReady = true,
) {
	useLayoutEffect(() => {
		if (!isReady) return undefined;

		const panel = ref.current;
		if (!panel) return undefined;
		const previous = document.activeElement as HTMLElement | null;
		// Unless the panel has already placed it: a page that autofocuses its own
		// field has said where focus belongs, and taking it back would undo that.
		if (!panel.contains(previous)) panel.focus({ preventScroll: true });

		return () => {
			if (panel.contains(document.activeElement))
				previous?.focus?.({ preventScroll: true });
		};
	}, [ref, isReady]);
}

// Nothing typed at an open menu belongs to the app behind it: without the
// stopPropagation the arrows seek the player and space toggles playback while
// you are choosing an action. Tab is the exception -- leaving by keyboard is
// the browser's business.
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
	const focus = (index: number) =>
		items[(index + items.length) % items.length]?.focus();

	if (beyond?.({ event, items, at })) {
		event.preventDefault();
		return;
	}

	// Everything else belongs to the field while a field has focus: Home, End and
	// the horizontal arrows are caret keys there, and every printable character
	// is just typing.
	if (event.target instanceof HTMLInputElement) return;

	const rove = ROVE[event.key];
	if (!rove) return;

	// Enter and Space on a focused item are deliberately not here: it is a real
	// button, and preventing the default is what would stop it being pressed.
	focus(rove(at));
	event.preventDefault();
}
