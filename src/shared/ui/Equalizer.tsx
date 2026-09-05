import styles from "./Equalizer.module.css";

// The mark for "the sound comes out here": the playing row in a track list, and every device the stream is attached to.
// Labelled where it is the only thing saying so, and hidden where the row already says it in words.
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
