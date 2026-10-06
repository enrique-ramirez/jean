import { classNames } from "@/shared/lib/classNames";

import styles from "./SwitchTrack.module.css";

export function SwitchTrack({ checked }: { checked: boolean }) {
	return (
		<span
			className={classNames(styles.track, checked && styles.checked)}
			aria-hidden="true"
		>
			<span className={styles.thumb} />
		</span>
	);
}
