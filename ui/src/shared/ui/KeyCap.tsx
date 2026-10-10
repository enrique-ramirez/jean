import { type BindingId, hintFor } from "@/shared/keyboard/keymap";
import { useSingleKeyShortcuts } from "@/shared/keyboard/useKeymap";
import styles from "./KeyCap.module.css";

export function KeyCap({
	binding,
	label,
}: {
	binding?: BindingId;
	label?: string;
}) {
	const [singleKeys] = useSingleKeyShortcuts();
	const text = label ?? (binding ? hintFor(binding, singleKeys) : null);
	if (text === null) return null;

	return (
		<span className={styles.decoration} aria-hidden="true">
			<kbd className={styles.cap}>{text}</kbd>
		</span>
	);
}
