import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useVisualViewport } from "@/shared/hooks/useVisualViewport";
import { translate } from "@/shared/i18n/locale";
import styles from "./ActionMenu.module.css";
import { Header, type PanelProps, usePanel } from "./actionPanel";
import { useFocusCapture } from "./menuKeys";

const SHEET_DISMISS_PX = 92;

export function ActionSheet({
	header,
	actions,
	isLeaving,
	onDismiss,
}: PanelProps & { isLeaving: boolean }) {
	const { body, onKeyDown, page, depth, back } = usePanel({
		actions,
		onDismiss,
		canFilter: true,
	});
	const ref = useDismissable<HTMLDivElement>(!isLeaving, onDismiss);
	const scrimRef = useRef<HTMLDivElement | null>(null);
	const [dragY, setDragY] = useState(0);
	const from = useRef<number | null>(null);

	useFocusCapture(ref);

	// The scrim is the sheet's containing block, so tracking the visual viewport here is what lifts
	// the sheet clear of the keyboard.
	useVisualViewport(scrimRef);

	const grabber = {
		onPointerDown: (event: ReactPointerEvent) => {
			event.currentTarget.setPointerCapture(event.pointerId);
			from.current = event.clientY;
		},
		onPointerMove: (event: ReactPointerEvent) => {
			if (from.current === null) return;
			setDragY(Math.max(0, event.clientY - from.current));
		},
		onPointerUp: (event: ReactPointerEvent) => {
			if (from.current === null) return;
			const travelled = event.clientY - from.current;
			from.current = null;
			setDragY(0);
			if (travelled > SHEET_DISMISS_PX) onDismiss();
		},
		onPointerCancel: () => {
			from.current = null;
			setDragY(0);
		},
	};

	return (
		<div
			ref={scrimRef}
			className={styles.scrim}
			data-owns-touch=""
			data-state={isLeaving ? "closed" : "open"}
		>
			<div
				ref={ref}
				className={styles.sheet}
				data-state={isLeaving ? "closed" : "open"}
				data-dragging={dragY > 0 ? "true" : undefined}
				style={
					dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)` } : undefined
				}
				role="dialog"
				aria-modal="true"
				aria-label={header?.title ?? translate("menu.actions")}
				tabIndex={-1}
				onKeyDown={onKeyDown}
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div className={styles.grabber} {...grabber}>
					<span className={styles.handle} aria-hidden="true" />
				</div>
				<Header header={header} page={page} depth={depth} onBack={back} />
				{body}
			</div>
		</div>
	);
}
