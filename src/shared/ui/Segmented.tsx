import type { IconComponent } from "./icons";
import styles from "./Segmented.module.css";

export interface SegmentedOption<T> {
	value: T;
	label: string;
	icon?: IconComponent;
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
		// biome-ignore lint/a11y/useSemanticElements: aria-pressed toggles in a toolbar, not form fields in a fieldset
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
