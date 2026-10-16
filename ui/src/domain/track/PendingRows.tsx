import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import { ROW_HEIGHT } from "./listTypes";
import styles from "./PendingRows.module.css";

const PLACEHOLDER_ROWS = 8;

export function PendingRows() {
	return (
		<div
			className={styles.rows}
			style={{ "--row-height": `${ROW_HEIGHT}px` } as React.CSSProperties}
			{...busyProps(true)}
		>
			{Array.from({ length: PLACEHOLDER_ROWS }, (_, at) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders are interchangeable and never reorder
					key={at}
					className={styles.row}
				>
					<Skeleton />
				</span>
			))}
			<BusyNote />
		</div>
	);
}
