import styles from "./Switch.module.css";

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

			<span className={styles.track} aria-hidden="true">
				<span className={styles.thumb} />
			</span>
		</button>
	);
}
