import styles from "./Equalizer.module.css";

export function Equalizer({
	label,
	paused = false,
}: {
	label?: string;
	paused?: boolean;
}) {
	const naming = label
		? ({ role: "img", "aria-label": label } as const)
		: ({ "aria-hidden": true } as const);

	return (
		<span className={styles.equalizer} data-paused={paused} {...naming}>
			<i />
			<i />
			<i />
		</span>
	);
}
