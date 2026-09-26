import {
	type ButtonHTMLAttributes,
	type ReactNode,
	useCallback,
	useEffect,
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
	placement = "below",
	className,
	role = "menu",
}: {
	isOpen: boolean;
	onDismiss: () => void;
	children: ReactNode;
	trigger: ReactNode;
	align?: "start" | "end";
	placement?: "below" | "above";
	className?: string;
	role?: string;
}) {
	const ref = useDismissable<HTMLDivElement>(isOpen, onDismiss);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const closedFromInsideRef = useRef(false);

	useLayoutEffect(() => {
		if (isOpen) {
			previousFocusRef.current = document.activeElement as HTMLElement | null;
			closedFromInsideRef.current = false;
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return undefined;
		const onPointerDown = (event: PointerEvent) => {
			closedFromInsideRef.current = Boolean(
				ref.current?.contains(event.target as Node),
			);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, ref]);

	// Not a layout effect: it has to run after every layout effect this commit touches, an item's
	// own click closing this menu while opening another `Menu` included (`ColumnsMenu`'s "What heat
	// means" does exactly that), whose own `useFocusCapture` claims focus for itself in that same
	// phase. Only once nothing else has claimed it, by the time this runs, is the trigger the right
	// place to put it back. And only where the close came from inside: an outside press must never
	// pull focus back to a trigger the user was not aiming at. `Menu` unmounts its panel the instant
	// it closes, and removing the focused row hands focus to `<body>` synchronously, before any of
	// this runs, which is why "does the panel still contain the active element" cannot be the test.
	useEffect(() => {
		if (isOpen) return;
		if (!closedFromInsideRef.current) return;
		if (document.activeElement !== document.body) return;
		previousFocusRef.current?.focus?.({ preventScroll: true });
	}, [isOpen]);

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
					data-placement={placement}
					role={role}
					tabIndex={-1}
					onKeyDown={(event) => {
						closedFromInsideRef.current = true;
						handleMenuKeys(event, {
							container: menuRef.current,
							onEscape: onDismiss,
						});
					}}
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
