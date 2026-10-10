import { X } from "lucide-react";
import type { KeyboardEventHandler, ReactNode } from "react";
import { useRef } from "react";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { useVisualViewport } from "@/shared/hooks/useVisualViewport";
import styles from "./BottomSheet.module.css";
import { useSheetDrag } from "./useSheetDrag";

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
	const dragY = useSheetDrag(ref, onDismiss, SHEET_DISMISS_PX);

	useTabTrap(ref, initialFocus);

	// The scrim is the sheet's containing block, so tracking the visual viewport here is what lifts
	// the sheet clear of the keyboard.
	useVisualViewport(scrimRef);

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
				<div className={styles.grabber}>
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
