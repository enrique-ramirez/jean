import { type ReactNode, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import styles from "./AlertDialog.module.css";
import { Button } from "./Button";

const ALERT_DIALOG_KEYBOARD = "alertDialog";

export interface AlertAction {
	label: string;
	onSelect: () => void;
	keyHint?: string;
	isDestructive?: boolean;
	isDefault?: boolean;
}

export function AlertDialog({
	title,
	body,
	actions,
}: {
	title: string;
	body: ReactNode;
	actions: readonly [AlertAction, AlertAction];
}) {
	const titleId = useId();
	const bodyId = useId();
	const dialog = useRef<HTMLDivElement | null>(null);
	const fallback = actions.find((action) => action.isDefault) ?? actions[0];

	useKeyboardOwnership(ALERT_DIALOG_KEYBOARD);
	useEscapeCapture(fallback.onSelect);
	useTabTrap(dialog, "[data-default]");

	return createPortal(
		<div className={styles.scrim}>
			<div
				ref={dialog}
				className={styles.alert}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={bodyId}
			>
				<h2 id={titleId} className={styles.title}>
					{title}
				</h2>
				<p id={bodyId} className={styles.body}>
					{body}
				</p>
				<div className={styles.actions}>
					{actions.map((action) => (
						<Button
							key={action.label}
							variant={
								action.isDestructive
									? "danger"
									: action.isDefault
										? "primary"
										: "default"
							}
							className={styles.action}
							data-default={action.isDefault ? "" : undefined}
							onClick={action.onSelect}
						>
							{action.label}
							{action.keyHint ? (
								<span className={styles.decoration} aria-hidden="true">
									<kbd className={styles.cap}>{action.keyHint}</kbd>
								</span>
							) : null}
						</Button>
					))}
				</div>
			</div>
		</div>,
		document.body,
	);
}
