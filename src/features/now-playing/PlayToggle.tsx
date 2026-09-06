import { useEffect, useState } from "react";

import { classNames } from "@/shared/lib/classNames";
import { PauseIcon, PlayIcon } from "@/shared/ui/icons";
import styles from "./PlayToggle.module.css";

const MOTIONS = ["equalizer", "fluid"];
const MOTION_CYCLE_MS = 8000;

export function PlayToggle({
	isPlaying,
	onToggle,
	variant = "bar",
	className,
}: {
	isPlaying: boolean;
	onToggle: () => void;
	variant?: "bar" | "screen";
	className?: string;
}) {
	const [motion, setMotion] = useState(MOTIONS[0]);

	useEffect(() => {
		if (!isPlaying) {
			setMotion(MOTIONS[0]);
			return undefined;
		}

		const timer = setInterval(
			() =>
				setMotion(
					(current) => MOTIONS[(MOTIONS.indexOf(current) + 1) % MOTIONS.length],
				),
			MOTION_CYCLE_MS,
		);
		return () => clearInterval(timer);
	}, [isPlaying]);

	return (
		<button
			type="button"
			className={classNames(styles.toggle, className)}
			data-size={variant}
			data-playing={isPlaying}
			data-motion={motion}
			aria-label={isPlaying ? "Pause" : "Play"}
			onClick={onToggle}
		>
			{isPlaying ? <PauseIcon /> : <PlayIcon />}
		</button>
	);
}
