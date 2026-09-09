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
import { useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import styles from "./Volume.module.css";

const iconFor = (percent: number, isMuted?: boolean) => {
	if (isMuted || percent === 0) return VolumeX;
	return percent < 50 ? Volume1 : Volume2;
};

export function VolumeGlyph({
	volume,
	size = 15,
}: {
	volume: VolumeState | null;
	size?: number;
}) {
	const Icon = iconFor(volumePercent(volume), volume?.isMuted);
	return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

function VolumeButton({
	volume,
	onPress,
	label,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	volume: VolumeState | null;
	onPress?: () => void;
	label: string;
}) {
	const t = useTranslate();
	const percent = volumePercent(volume);

	return (
		<button
			type="button"
			className={styles.button}
			onClick={onPress}
			aria-pressed={Boolean(volume?.isMuted)}
			aria-label={t(volume?.isMuted ? "player.unmute" : "player.mute")}
			title={
				volume?.isMuted
					? t("player.muted")
					: t("player.volumeAt", { label, percent })
			}
			{...props}
		>
			<VolumeGlyph volume={volume} size={17} />
		</button>
	);
}

export function VolumeSlider({
	volume,
	onChange,
	orientation = "horizontal",
	className,
	label,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	orientation?: "horizontal" | "vertical";
	className?: string;
	label: string;
}) {
	const t = useTranslate();
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
			className={classNames(styles.slider, className)}
			data-orientation={orientation}
			data-dragging={isDragging}
			data-muted={Boolean(volume?.isMuted)}
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			aria-valuetext={volume?.isMuted ? t("player.muted") : `${percent}%`}
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

export function VolumePopover({
	volume,
	onChange,
	label,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	label: string;
}) {
	const t = useTranslate();
	const [isOpen, setIsOpen] = useState(false);
	const ref = useDismissable<HTMLDivElement>(isOpen, () => setIsOpen(false));

	return (
		<div className={styles.popoverAnchor} ref={ref}>
			{isOpen ? (
				<div className={styles.popover} data-owns-touch="">
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
				aria-label={t(isOpen ? "player.hideVolume" : "player.showVolume")}
				aria-expanded={isOpen}
			/>
		</div>
	);
}

export function Volume({
	volume,
	onChange,
	onToggleMute,
	label,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	onToggleMute: () => void;
	label: string;
}) {
	return (
		<div className={styles.volume}>
			<VolumeButton volume={volume} label={label} onPress={onToggleMute} />
			<VolumeSlider volume={volume} onChange={onChange} label={label} />
		</div>
	);
}
