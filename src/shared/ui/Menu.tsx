import {
	type ButtonHTMLAttributes,
	type ComponentType,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";

import { useDismissable } from "@/shared/hooks/useDismissable";
import styles from "./Menu.module.css";
import { handleMenuKeys, useFocusCapture } from "./menuKeys";

// How close a popover may come to the edge of the window before it is pushed
// back in.
const GUTTER = 8;

// A dropdown anchored under a button you can see, as opposed to a menu you
// summoned at the pointer -- that one is `ActionMenu`. What the two do share is
// the keyboard: while either is open it owns every key, or Escape closes the
// panel *and* clears the selection behind it, and the arrows seek the player
// while you are choosing a column. See `menuKeys.js`.
export function Menu({
	isOpen,
	onDismiss,
	children,
	trigger,
	align = "end",
	className,
	role = "menu",
}: {
	isOpen: boolean;
	onDismiss: () => void;
	children: ReactNode;
	trigger: ReactNode;
	align?: "start" | "end";
	className?: string;
	role?: string;
}) {
	const ref = useDismissable<HTMLDivElement>(isOpen, onDismiss);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useFocusCapture(menuRef, isOpen);

	// A dropdown is anchored to its trigger, and a trigger near an edge puts it
	// off screen -- on a phone, a wide popover hanging off a button near the right
	// edge starts outside the window and loses its own first characters. Nothing
	// in `left: 0` / `right: 0` can know that; only the layout can.
	//
	// Written to the element rather than into state: this runs on open and on
	// every resize, and a render per resize event would repaint whatever the menu
	// is sitting over, including a virtualised list.
	const clamp = useCallback(() => {
		const element = menuRef.current;
		if (!element) return;

		// Read with no correction in place, or each pass measures the previous
		// pass's shift and compounds it.
		element.style.setProperty("--menu-shift", "0px");
		const rect = element.getBoundingClientRect();

		// clientWidth, not innerWidth: it excludes a classic scrollbar, which
		// innerWidth counts as space the menu is allowed to sit under.
		const pastLeft = GUTTER - rect.left;
		const pastRight =
			rect.right - (document.documentElement.clientWidth - GUTTER);
		// Left wins when the menu is too wide for the window to hold either way:
		// reading the start of it beats reading the end.
		const shift = pastLeft > 0 ? pastLeft : pastRight > 0 ? -pastRight : 0;

		element.style.setProperty("--menu-shift", `${shift}px`);
	}, []);

	useLayoutEffect(() => {
		if (!isOpen) return undefined;
		clamp();
		// Rotating the phone moves the anchor without reopening the menu.
		window.addEventListener("resize", clamp);
		return () => window.removeEventListener("resize", clamp);
	}, [isOpen, clamp]);

	return (
		<div className={styles.anchor} ref={ref}>
			{trigger}
			{isOpen ? (
				// Same as ActionMenu: while a menu is open every key belongs to it, and
				// the panel is where that is enforced.
				// biome-ignore lint/a11y/noStaticElementInteractions: menu panel, see above
				<div
					ref={menuRef}
					className={[styles.menu, className].filter(Boolean).join(" ")}
					data-align={align}
					role={role}
					tabIndex={-1}
					onKeyDown={(event) =>
						handleMenuKeys(event, {
							container: menuRef.current,
							onEscape: onDismiss,
						})
					}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}

export function MenuItem({
	icon: Icon,
	shortcut,
	children,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	icon?: ComponentType<{
		size?: number;
		strokeWidth?: number;
		"aria-hidden"?: "true";
	}>;
	shortcut?: string;
}) {
	return (
		<button type="button" className={styles.item} role="menuitem" {...props}>
			{Icon ? <Icon size={15} strokeWidth={2} aria-hidden="true" /> : null}
			{children}
			{shortcut ? <span className={styles.shortcut}>{shortcut}</span> : null}
		</button>
	);
}

export function MenuSeparator() {
	return <hr className={styles.separator} />;
}
