import type { ReactNode } from "react";
import { classNames } from "@/shared/lib/classNames";
import styles from "./Tabs.module.css";

export interface TabOption<T extends string> {
	value: T;
	label: string;
	// How many leading characters of the label its shortcut spells, underlined as the hint. Zero when
	// the key is not the label's own initial, which is the honest answer rather than a hint that lies.
	mnemonic?: number;
}

/**
 * Tabs, and deliberately not `Segmented`: a segmented control switches how one thing is drawn, where
 * tabs move between different things. Keeping the two apart is what stops either from meaning both.
 */
export function Tabs<T extends string>({
	value,
	options,
	label,
	onChange,
	className,
	children,
}: {
	value: T;
	options: TabOption<T>[];
	label: string;
	onChange: (value: T) => void;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<nav className={classNames(styles.tabs, className)} aria-label={label}>
			{options.map((option) => {
				const marked = option.mnemonic ?? 0;
				return (
					<button
						key={option.value}
						type="button"
						className={styles.tab}
						aria-current={value === option.value}
						onClick={() => onChange(option.value)}
					>
						{marked > 0 ? (
							<span className={styles.key}>
								{option.label.slice(0, marked)}
							</span>
						) : null}
						{option.label.slice(marked)}
					</button>
				);
			})}

			{children}
		</nav>
	);
}
