import { useEffect, useState } from "react";

import { classNames } from "@/shared/lib/classNames";
import { PauseIcon, PlayIcon } from "@/shared/ui/icons";
import styles from "./PlayToggle.module.css";

// The playing state alternates between two motions. Owned here rather than by a caller, so the two buttons in the app do not each keep their own clock.
const MOTIONS = ["equalizer", "fluid"];
const MOTION_CYCLE_MS = 8000;

// One button at two sizes. The size is a `variant` rather than a number because the button also shrinks at a breakpoint, so the stylesheet owns every dimension.
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
			{/* Sized by the stylesheet from `--play-size`: CSS beats the width and height lucide writes as attributes. */}
			{isPlaying ? <PauseIcon /> : <PlayIcon />}
		</button>
	);
}
