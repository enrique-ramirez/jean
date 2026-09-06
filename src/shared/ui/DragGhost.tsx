import { Ban, Music } from "lucide-react";
import styles from "./DragGhost.module.css";
import { setGhostElement, useDragState } from "./dnd";

export function DragGhost() {
	const { isDragging, over, count, label, refusal } = useDragState();
	if (!isDragging) return null;

	return (
		// Two elements on purpose: a CSS animation beats an inline style, so an entrance that touched
		// `transform` would override the position written every frame.
		<div ref={setGhostElement} className={styles.ghost}>
			{/* The refusal replaces what is being dragged rather than sitting beside it: the eye is on
			    the pointer, and "why not" is the only thing worth reading once the answer is no. */}
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
							<span className={styles.count}>{count.toLocaleString()}</span>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
