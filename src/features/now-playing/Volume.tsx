import { Volume1, Volume2, VolumeX } from "lucide-react";
import { type ButtonHTMLAttributes, useState } from "react";
import {
	fractionToVolume,
	volumePercent,
	volumeToFraction,
} from "@/domain/player/volumeScale";
import type { Volume as VolumeState } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useDragFraction } from "@/shared/hooks/useDragFraction";
import styles from "./Volume.module.css";

const iconFor = (percent: number, isMuted?: boolean) => {
	if (isMuted || percent === 0) return VolumeX;
	return percent < 50 ? Volume1 : Volume2;
};

// The press is the caller's: it mutes on desktop and opens the fader on a phone.
function VolumeButton({
	volume,
	onPress,
	label = "Volume",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	volume: VolumeState | null;
	onPress?: () => void;
	/** Which volume this is: the control retargets to whichever device the sound is coming out of. */
	label?: string;
}) {
	const percent = volumePercent(volume);
	const Icon = iconFor(percent, volume?.isMuted);

	return (
		<button
			type="button"
			className={styles.button}
			onClick={onPress}
			aria-pressed={Boolean(volume?.isMuted)}
			aria-label={volume?.isMuted ? "Unmute" : "Mute"}
			title={volume?.isMuted ? "Muted" : `${label} ${percent}%`}
			{...props}
		>
			<Icon size={17} strokeWidth={2} aria-hidden="true" />
		</button>
	);
}

export function VolumeSlider({
	volume,
	onChange,
	orientation = "horizontal",
	className,
	label = "Volume",
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	orientation?: "horizontal" | "vertical";
	className?: string;
	label?: string;
}) {
	const { ref, fraction, isDragging, handlers } = useDragFraction({
		onDrag: (next) => onChange(fractionToVolume(volume as VolumeState, next)),
		onCommit: (next) => onChange(fractionToVolume(volume as VolumeState, next)),
		disabled: !volume,
		orientation,
	});

	const shown = fraction ?? volumeToFraction(volume);
	const percent = Math.round(shown * 100);

	return (
		<div
			ref={ref}
			className={[styles.slider, className].filter(Boolean).join(" ")}
			data-orientation={orientation}
			data-dragging={isDragging}
			data-muted={Boolean(volume?.isMuted)}
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			aria-valuetext={volume?.isMuted ? "Muted" : `${percent}%`}
			{...handlers}
		>
			<span className={styles.rail} />
			<span
				className={styles.fill}
				style={{
					transform:
						orientation === "vertical"
							? `scaleY(${shown})`
							: `scaleX(${shown})`,
				}}
			/>
			<span
				className={styles.thumb}
				style={
					orientation === "vertical"
						? { bottom: `${shown * 100}%` }
						: { left: `${shown * 100}%` }
				}
			/>
		</div>
	);
}

// Mobile. A column above the button rather than taking over the row, so the button here only opens and closes.
export function VolumePopover({
	volume,
	onChange,
	label = "Volume",
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	label?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const ref = useDismissable<HTMLDivElement>(isOpen, () => setIsOpen(false));

	return (
		<div className={styles.popoverAnchor} ref={ref}>
			{isOpen ? (
				<div className={styles.popover}>
					<VolumeSlider
						volume={volume}
						onChange={onChange}
						orientation="vertical"
						label={label}
					/>
					<span className={styles.readout}>{volumePercent(volume)}</span>
				</div>
			) : null}

			<VolumeButton
				volume={volume}
				label={label}
				onPress={() => setIsOpen((open) => !open)}
				aria-label={isOpen ? "Hide volume" : "Show volume"}
				aria-expanded={isOpen}
			/>
		</div>
	);
}

export function Volume({
	volume,
	onChange,
	onToggleMute,
	label = "Volume",
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	onToggleMute: () => void;
	label?: string;
}) {
	return (
		<div className={styles.volume}>
			<VolumeButton volume={volume} label={label} onPress={onToggleMute} />
			<VolumeSlider volume={volume} onChange={onChange} label={label} />
		</div>
	);
}
