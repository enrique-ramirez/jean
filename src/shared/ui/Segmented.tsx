import type { ComponentType } from "react";

import styles from "./Segmented.module.css";

export interface SegmentedOption<T> {
	value: T;
	label: string;
	icon?: ComponentType<{
		size?: number;
		strokeWidth?: number;
		"aria-hidden"?: "true";
	}>;
}

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	label,
}: {
	value: T;
	onChange: (value: T) => void;
	options: SegmentedOption<T>[];
	label?: string;
}) {
	return (
		// A fieldset wants a legend and brings its own styling; these are aria-pressed toggles in a toolbar rather than form fields.
		// biome-ignore lint/a11y/useSemanticElements: not a fieldset, see above
		<div className={styles.segmented} role="group" aria-label={label}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					className={styles.option}
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
					title={option.label}
				>
					{option.icon ? (
						<option.icon size={14} strokeWidth={2} aria-hidden="true" />
					) : null}
					<span className={styles.label}>{option.label}</span>
				</button>
			))}
		</div>
	);
}
