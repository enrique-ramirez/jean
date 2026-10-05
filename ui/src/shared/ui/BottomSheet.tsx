import { X } from "lucide-react";
import type {
	KeyboardEventHandler,
	ReactNode,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useRef, useState } from "react";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useVisualViewport } from "@/shared/hooks/useVisualViewport";
import styles from "./BottomSheet.module.css";
import { useFocusCapture } from "./menuKeys";

const SHEET_DISMISS_PX = 92;

export const SHEET_EXIT_MS = 220;

const TOASTS = "[data-toasts]";

export type SheetLayer = "picker" | "actionMenu";

export interface BottomSheetProps {
	label: string;
	closeLabel?: string;
	isLeaving: boolean;
	layer: SheetLayer;
	onDismiss: () => void;
	onKeyDown?: KeyboardEventHandler;
	initialFocus?: string;
	className?: string;
	children: ReactNode;
}

export function BottomSheet({
	label,
	closeLabel,
	isLeaving,
	layer,
	onDismiss,
	onKeyDown,
	initialFocus,
	className,
	children,
}: BottomSheetProps) {
	const ref = useDismissable<HTMLDivElement>(!isLeaving, onDismiss, {
		ignore: TOASTS,
		tapOutsideOnlyDismisses: true,
	});
	const scrimRef = useRef<HTMLDivElement | null>(null);
	const [dragY, setDragY] = useState(0);
	const from = useRef<number | null>(null);

	useFocusCapture(ref, true, initialFocus);

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

	const state = isLeaving ? "closed" : "open";

	return (
		<div
			ref={scrimRef}
			className={styles.scrim}
			data-layer={layer}
			data-owns-touch=""
			data-state={state}
		>
			<div
				ref={ref}
				className={className ? `${styles.sheet} ${className}` : styles.sheet}
				data-state={state}
				data-dragging={dragY > 0 ? "true" : undefined}
				style={
					dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)` } : undefined
				}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabIndex={-1}
				onKeyDown={onKeyDown}
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div className={styles.grabber} {...grabber}>
					<span className={styles.handle} aria-hidden="true" />
				</div>
				{closeLabel ? (
					<div className={styles.heading}>
						<h2 className={styles.title}>{label}</h2>
						<button
							type="button"
							className={styles.close}
							aria-label={closeLabel}
							onClick={onDismiss}
						>
							<X size={19} strokeWidth={2} aria-hidden="true" />
						</button>
					</div>
				) : null}
				{children}
			</div>
		</div>
	);
}
