import { Ban, Music } from "lucide-react";
import { useFormats } from "@/shared/i18n/useTranslate";
import styles from "./DragGhost.module.css";
import { setGhostElement, useDragState } from "./dnd";

export function DragGhost() {
	const format = useFormats();
	const { isDragging, over, count, label, refusal } = useDragState();
	if (!isDragging) return null;

	return (
		// Two elements on purpose: a CSS animation beats an inline style, so an entrance that touched
		// `transform` would override the position written every frame.
		<div ref={setGhostElement} className={styles.ghost}>
			<div
				className={styles.pill}
				data-armed={over ? "true" : undefined}
				data-refused={refusal ? "true" : undefined}
			>
				{refusal ? (
					<>
						<Ban size={14} strokeWidth={2} aria-hidden="true" />
						<span className={styles.label}>{refusal}</span>
					</>
				) : (
					<>
						<Music size={14} strokeWidth={2} aria-hidden="true" />
						<span className={styles.label}>{label}</span>
						{count > 1 ? (
							<span className={styles.count}>{format.number(count)}</span>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
