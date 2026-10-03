import { type BindingId, hintFor } from "@/shared/keyboard/keymap";
import styles from "./KeyCap.module.css";

export function KeyCap({
	binding,
	label,
}: {
	binding?: BindingId;
	label?: string;
}) {
	return (
		<span className={styles.decoration} aria-hidden="true">
			<kbd className={styles.cap}>
				{label ?? (binding ? hintFor(binding) : null)}
			</kbd>
		</span>
	);
}
