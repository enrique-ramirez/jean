import { X } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
} from "react";

import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { KeyCap } from "./KeyCap";
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

	useKeyboardOwnership(keyboardOwner);
	useTabTrap(dialogRef);

	const dismiss = useEffectEvent(onDismiss);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// The ARIA combobox pattern: Escape closes an expanded popup before it closes anything else.
			const isExpandedCombobox =
				event.target instanceof Element &&
				event.target.matches('[role="combobox"][aria-expanded="true"]');
			if (isExpandedCombobox) return;
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, []);

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
						<KeyCap label="Esc" />
						<X size={16} strokeWidth={2} aria-hidden="true" />
					</button>

					{action ? <div className={styles.action}>{action}</div> : null}
				</header>

				{children}
			</div>
		</div>
	);
}
