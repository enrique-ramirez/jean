import { type ReactNode, useId } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Switch.module.css";
import { SwitchTrack } from "./SwitchTrack";

export function Switch({
	checked,
	label,
	description,
	hint,
	disabled,
	onChange,
}: {
	checked: boolean;
	label: string;
	description?: string;
	hint?: ReactNode;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();

	return (
		<div className={classNames(styles.row, disabled && styles.disabled)}>
			<label className={styles.text} htmlFor={id}>
				<span className={styles.label}>{label}</span>
				{description ? (
					<span className={styles.description}>{description}</span>
				) : null}
			</label>

			{hint}

			<button
				type="button"
				role="switch"
				id={id}
				aria-checked={checked}
				disabled={disabled}
				className={styles.toggle}
				onClick={() => onChange(!checked)}
			>
				<SwitchTrack checked={checked} />
			</button>
		</div>
	);
}
