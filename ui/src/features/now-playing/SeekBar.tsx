import { useEffect, useState } from "react";
import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDragFraction } from "@/shared/hooks/useDragFraction";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./SeekBar.module.css";

const useTickingPosition = (
	snapshot: PlayerSnapshot | null | undefined,
	resolution: (at: number) => number,
) => {
	const [held, setHeld] = useState(() => ({
		snapshot,
		value: resolution(audibleAt(snapshot)),
	}));

	let { value } = held;
	if (held.snapshot !== snapshot) {
		value = resolution(audibleAt(snapshot));
		setHeld({ snapshot, value });
	}

	const isPlaying = snapshot?.player?.playbackState === "playing";

	useEffect(() => {
		if (!isPlaying) return undefined;
		let frame = requestAnimationFrame(function tick() {
			const next = resolution(audibleAt(snapshot));
			setHeld((current) =>
				current.value === next ? current : { snapshot, value: next },
			);
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [snapshot, resolution, isPlaying]);

	return value;
};

const exactly = (at: number) => at;

export const useElapsed = (snapshot: PlayerSnapshot | null | undefined) =>
	useTickingPosition(snapshot, exactly);

export const useElapsedSeconds = (
	snapshot: PlayerSnapshot | null | undefined,
) => useTickingPosition(snapshot, Math.floor);

export function SeekBar({
	snapshot,
	onSeek,
	disabled = false,
}: {
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (position: number) => void;
	disabled?: boolean;
}) {
	const t = useTranslate();
	const elapsed = useElapsed(snapshot);

	const duration = snapshot?.player?.activeItem?.duration ?? 0;
	const canSeek = duration > 0;

	const { ref, fraction, isDragging, handlers } = useDragFraction({
		onCommit: (next) => onSeek(next * duration),
		disabled: disabled || !canSeek,
	});

	const progress = fraction ?? (canSeek ? Math.min(elapsed / duration, 1) : 0);
	const baseLabel = t("player.position");

	return (
		<div
			ref={ref}
			className={styles.bar}
			data-scrubbing={isDragging}
			data-seekable={canSeek}
			role="slider"
			tabIndex={disabled || canSeek ? 0 : -1}
			aria-disabled={disabled || undefined}
			aria-label={
				disabled
					? t("player.controlOffName", { control: baseLabel })
					: baseLabel
			}
			aria-valuemin={0}
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(progress * duration)}
			{...handlers}
		>
			<span className={styles.rail} />
			<span
				className={styles.fill}
				style={{ transform: `scaleX(${progress})` }}
			/>
			<span
				className={styles.thumb}
				style={{ transform: `translateX(${progress * 100}cqw)` }}
			/>
		</div>
	);
}
