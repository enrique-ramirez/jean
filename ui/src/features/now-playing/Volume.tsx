import { ChevronUp, Volume1, Volume2, VolumeX } from "lucide-react";
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
import { Menu } from "@/shared/ui/Menu";
import {
	OutputCog,
	OutputDeviceList,
	OutputMenuRows,
	type OutputPicker,
	useOutputPage,
} from "./OutputDevices";
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
	disabled = false,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	volume: VolumeState | null;
	onPress?: () => void;
	label: string;
	disabled?: boolean;
}) {
	const t = useTranslate();
	const percent = volumePercent(volume);
	const baseLabel = t(volume?.isMuted ? "player.unmute" : "player.mute");

	return (
		<button
			type="button"
			className={styles.button}
			onClick={disabled ? undefined : onPress}
			aria-pressed={Boolean(volume?.isMuted)}
			aria-disabled={disabled || undefined}
			aria-label={
				disabled
					? t("player.controlOffName", { control: baseLabel })
					: baseLabel
			}
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
	disabled = false,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	orientation?: "horizontal" | "vertical";
	className?: string;
	label: string;
	disabled?: boolean;
}) {
	const t = useTranslate();
	const { ref, fraction, isDragging, handlers } = useDragFraction({
		onDrag: (next) => onChange(fractionToVolume(volume as VolumeState, next)),
		onCommit: (next) => onChange(fractionToVolume(volume as VolumeState, next)),
		disabled: disabled || !volume,
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
			aria-disabled={disabled || undefined}
			aria-label={
				disabled ? t("player.controlOffName", { control: label }) : label
			}
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

// The caret beside the volume icon on a wide viewport: straight to the list, no heading and no
// intermediate menu, opening upward since the status bar sits at the foot of the window.
function OutputCaret({ devices, activeId, onChoose, onOpen }: OutputPicker) {
	const t = useTranslate();
	const [isOpen, setIsOpen] = useState(false);
	const label = t("player.outputOptions");

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => setIsOpen(false)}
			placement="above"
			className={styles.outputMenu}
			trigger={
				<button
					type="button"
					className={styles.caret}
					aria-label={label}
					title={label}
					aria-expanded={isOpen}
					onClick={() => {
						const opening = !isOpen;
						setIsOpen(opening);
						if (opening) onOpen();
					}}
				>
					<ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
				</button>
			}
		>
			<OutputMenuRows
				devices={devices}
				activeId={activeId}
				onChoose={(deviceId) => {
					onChoose(deviceId);
					setIsOpen(false);
				}}
			/>
		</Menu>
	);
}

export function VolumePopover({
	volume,
	onChange,
	label,
	disabled = false,
	outputs,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	label: string;
	disabled?: boolean;
	outputs?: OutputPicker;
}) {
	const t = useTranslate();
	const [isOpen, setIsOpen] = useState(false);
	const ref = useDismissable<HTMLDivElement>(isOpen, () => setIsOpen(false));
	const outputPage = useOutputPage(isOpen);

	return (
		<div className={styles.popoverAnchor} ref={ref}>
			{isOpen ? (
				<div
					className={styles.popover}
					data-paged={outputPage.showsOutputs}
					data-owns-touch=""
				>
					{outputPage.showsOutputs && outputs ? (
						<OutputDeviceList
							devices={outputs.devices}
							activeId={outputs.activeId}
							onChoose={outputs.onChoose}
							onBack={outputPage.close}
						/>
					) : (
						<>
							<VolumeSlider
								volume={volume}
								onChange={onChange}
								orientation="vertical"
								label={label}
								disabled={disabled}
							/>
							<span className={styles.readout}>{volumePercent(volume)}</span>
							{outputs ? (
								<OutputCog
									onClick={() => outputPage.open(outputs.onOpen)}
									autoFocus={outputPage.returnFocus}
								/>
							) : null}
						</>
					)}
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
	disabled = false,
	outputs,
}: {
	volume: VolumeState | null;
	onChange: (value: number) => void;
	onToggleMute: () => void;
	label: string;
	disabled?: boolean;
	outputs?: OutputPicker;
}) {
	return (
		<div className={styles.volume}>
			{outputs ? (
				<div className={styles.group}>
					<VolumeButton
						volume={volume}
						label={label}
						onPress={onToggleMute}
						disabled={disabled}
					/>
					<OutputCaret {...outputs} />
				</div>
			) : (
				<VolumeButton
					volume={volume}
					label={label}
					onPress={onToggleMute}
					disabled={disabled}
				/>
			)}
			<VolumeSlider
				volume={volume}
				onChange={onChange}
				label={label}
				disabled={disabled}
			/>
		</div>
	);
}
