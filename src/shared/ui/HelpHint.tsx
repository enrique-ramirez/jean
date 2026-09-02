import { HelpCircle } from "lucide-react";
import { type ReactNode, useState } from "react";

import styles from "./HelpHint.module.css";

// A fragment: the caller's head row must wrap, so the text takes the line below
// the button. A popover was clipped by the settings dialog's scroller.
export function HelpHint({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				className={styles.trigger}
				aria-label={label}
				aria-expanded={isOpen}
				onClick={() => setIsOpen((current) => !current)}
			>
				<HelpCircle size={15} strokeWidth={2} aria-hidden="true" />
			</button>

			{isOpen ? <div className={styles.body}>{children}</div> : null}
		</>
	);
}
