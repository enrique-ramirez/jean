import { useEffect, useState } from "react";
import {
	type PlaybackRefusal,
	whenAllowed,
} from "@/domain/player/usePlaybackControl";
import { useLongPress } from "@/shared/hooks/useLongPress";
import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { PauseIcon, PlayIcon } from "@/shared/ui/icons";
import { pushToast } from "@/shared/ui/toastStore";
import styles from "./PlayToggle.module.css";

const MOTIONS = ["equalizer", "fluid"];
const MOTION_CYCLE_MS = 8000;

export function PlayToggle({
	isPlaying,
	onToggle,
	variant = "bar",
	className,
	refusal = null,
}: {
	isPlaying: boolean;
	onToggle: () => void;
	variant?: "bar" | "screen";
	className?: string;
	refusal?: PlaybackRefusal | null;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const [motion, setMotion] = useState(MOTIONS[0]);
	const longPress = useLongPress(
		() => pushToast({ message: t("player.palyyy"), tone: "neutral" }),
		{ withMouse: true },
	);

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

	const baseLabel = say(isPlaying ? "player.pause" : "player.play");

	return (
		<button
			{...longPress}
			type="button"
			className={classNames(styles.toggle, className)}
			data-size={variant}
			data-playing={isPlaying}
			data-motion={motion}
			aria-label={baseLabel}
			{...whenAllowed(refusal, onToggle, baseLabel, say)}
		>
			{isPlaying ? <PauseIcon /> : <PlayIcon />}
		</button>
	);
}
