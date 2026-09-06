import {
	type ButtonHTMLAttributes,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";

import { useDismissable } from "@/shared/hooks/useDismissable";
import { classNames } from "@/shared/lib/classNames";
import type { IconComponent } from "./icons";
import styles from "./Menu.module.css";
import { handleMenuKeys, useFocusCapture } from "./menuKeys";

const GUTTER = 8;

// A dropdown anchored under its trigger; a menu summoned at the pointer is ActionMenu. Both own every key while open.
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

	// A trigger near an edge puts a wide popover off screen, and only the layout can know that.
	// Written to the element rather than into state: this runs on every resize, and a render per event would repaint whatever the menu sits over.
	const keepInWindow = useCallback(() => {
		const element = menuRef.current;
		if (!element) return;

		// Read with no correction in place, or each pass measures the previous pass's shift and compounds it.
		element.style.setProperty("--menu-shift", "0px");
		const rect = element.getBoundingClientRect();

		// clientWidth, not innerWidth: it excludes a classic scrollbar, which innerWidth counts as space the menu is allowed to sit under.
		const pastLeft = GUTTER - rect.left;
		const pastRight =
			rect.right - (document.documentElement.clientWidth - GUTTER);
		// Left wins when the menu is too wide for the window to hold either way: reading the start of it beats reading the end.
		const shift = pastLeft > 0 ? pastLeft : pastRight > 0 ? -pastRight : 0;

		element.style.setProperty("--menu-shift", `${shift}px`);
	}, []);

	useLayoutEffect(() => {
		if (!isOpen) return undefined;
		keepInWindow();
		// Rotating the phone moves the anchor without reopening the menu.
		window.addEventListener("resize", keepInWindow);
		return () => window.removeEventListener("resize", keepInWindow);
	}, [isOpen, keepInWindow]);

	return (
		<div className={styles.anchor} ref={ref}>
			{trigger}
			{isOpen ? (
				// While a menu is open every key belongs to it, and the panel is where that is enforced.
				// biome-ignore lint/a11y/noStaticElementInteractions: menu panel, see above
				<div
					ref={menuRef}
					className={classNames(styles.menu, className)}
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
	icon?: IconComponent;
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
