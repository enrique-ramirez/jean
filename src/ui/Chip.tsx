import type { ReactNode } from "react";

import styles from "./Chip.module.css";

export function Chip({
	label,
	value,
}: {
	label: ReactNode;
	value?: ReactNode;
}) {
	return (
		<span className={styles.chip}>
			{label}
			{value == null ? null : <b>{value}</b>}
		</span>
	);
}
