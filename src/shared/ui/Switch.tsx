import styles from "./Switch.module.css";

// For a setting that takes effect the moment it moves. A checkbox is for a
// selection something else submits; see `shared/ui/CLAUDE.md`.
export function Switch({
	checked,
	label,
	description,
	disabled,
	onChange,
}: {
	checked: boolean;
	label: string;
	description?: string;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			className={styles.row}
			onClick={() => onChange(!checked)}
		>
			<span className={styles.text}>
				<span className={styles.label}>{label}</span>
				{description ? (
					<span className={styles.description}>{description}</span>
				) : null}
			</span>

			{/* The button carries the name and the state; these are decoration. */}
			<span className={styles.track} aria-hidden="true">
				<span className={styles.thumb} />
			</span>
		</button>
	);
}
