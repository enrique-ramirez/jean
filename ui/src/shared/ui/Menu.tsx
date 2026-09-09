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

	const keepInWindow = useCallback(() => {
		const element = menuRef.current;
		if (!element) return;

		element.style.setProperty("--menu-shift", "0px");
		const rect = element.getBoundingClientRect();

		const pastLeft = GUTTER - rect.left;
		const pastRight =
			rect.right - (document.documentElement.clientWidth - GUTTER);
		const shift = pastLeft > 0 ? pastLeft : pastRight > 0 ? -pastRight : 0;

		element.style.setProperty("--menu-shift", `${shift}px`);
	}, []);

	useLayoutEffect(() => {
		if (!isOpen) return undefined;
		keepInWindow();
		window.addEventListener("resize", keepInWindow);
		return () => window.removeEventListener("resize", keepInWindow);
	}, [isOpen, keepInWindow]);

	return (
		<div className={styles.anchor} ref={ref}>
			{trigger}
			{isOpen ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: the panel is where a menu taking every key while open is enforced
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
