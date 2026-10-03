import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { focusableIn } from "@/shared/hooks/useTabTrap";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import styles from "./ModalDialog.module.css";

export function ModalDialog({
	keyboardOwner,
	title,
	closeLabel,
	onDismiss,
	size = "narrow",
	action,
	children,
}: {
	keyboardOwner: string;
	title: string;
	closeLabel: string;
	onDismiss: () => void;
	size?: "narrow" | "wide";
	action?: ReactNode;
	children?: ReactNode;
}) {
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const titleId = useId();
	// Read while rendering: React runs a child's `autoFocus` before any effect here, and it would be recorded instead.
	const [opener] = useState(() => document.activeElement as HTMLElement | null);

	useKeyboardOwnership(keyboardOwner);

	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog?.contains(document.activeElement)) dialog?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// The ARIA combobox pattern: Escape closes an expanded popup before it closes anything else.
				const isExpandedCombobox =
					event.target instanceof Element &&
					event.target.matches('[role="combobox"][aria-expanded="true"]');
				if (isExpandedCombobox) return;
				event.preventDefault();
				event.stopPropagation();
				dismiss.current();
				return;
			}

			if (event.key !== "Tab" || !dialog) return;

			const focusable = focusableIn(dialog);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) return;

			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			if (opener?.isConnected) opener.focus();
		};
	}, [opener]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a dismissal scrim, not a control
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget) onDismiss();
			}}
		>
			<div
				ref={dialogRef}
				className={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				data-size={size}
				tabIndex={-1}
			>
				<header
					className={styles.header}
					data-has-action={action ? true : undefined}
				>
					<h1 className={styles.title} id={titleId}>
						{title}
					</h1>

					<button
						type="button"
						className={styles.close}
						onClick={onDismiss}
						aria-label={closeLabel}
					>
						<kbd className={styles.cap}>Esc</kbd>
						<X size={16} strokeWidth={2} aria-hidden="true" />
					</button>

					{action ? <div className={styles.action}>{action}</div> : null}
				</header>

				{children}
			</div>
		</div>
	);
}
