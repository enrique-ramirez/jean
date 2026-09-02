import { useEffect, useState } from "react";

import { PauseIcon, PlayIcon } from "@/shared/ui/icons";
import styles from "./PlayToggle.module.css";

// The playing state alternates between two motions rather than settling on one,
// so neither has time to become wallpaper. Owned here rather than by a caller:
// there are two of these buttons in the app and they must not each keep their
// own clock.
const MOTIONS = ["equalizer", "fluid"];
const MOTION_CYCLE_MS = 8000;

/**
 * Play/pause, and the one continuously animated thing in Jean.
 *
 * The status bar and the now-playing screen draw *this*, at two sizes, rather
 * than one each: the motion is the whole personality of the control, and the
 * second copy would be the one that drifts.
 *
 * The two sizes are a *variant*, not a number, because the button also shrinks
 * at the 720px breakpoint -- and anything spatial belongs to the media query
 * rather than to a prop that a JS breakpoint would have to feed. The stylesheet
 * owns every dimension, including the icon's, which is derived from the button
 * so the bigger one is the same button rather than a differently balanced one.
 */
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
			className={[styles.toggle, className].filter(Boolean).join(" ")}
			data-size={variant}
			data-playing={isPlaying}
			data-motion={motion}
			aria-label={isPlaying ? "Pause" : "Play"}
			onClick={onToggle}
		>
			{/* Sized by the stylesheet from `--play-size`; CSS beats the width and
          height lucide writes as attributes. */}
			{isPlaying ? <PauseIcon /> : <PlayIcon />}
		</button>
	);
}
