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
	const [elapsed, setElapsed] = useState(() => resolution(audibleAt(snapshot)));

	useEffect(() => {
		let frame = requestAnimationFrame(function tick() {
			setElapsed(resolution(audibleAt(snapshot)));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [snapshot, resolution]);

	return elapsed;
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
}: {
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (position: number) => void;
}) {
	const t = useTranslate();
	const elapsed = useElapsed(snapshot);

	const duration = snapshot?.player?.activeItem?.duration ?? 0;
	const canSeek = duration > 0;

	const { ref, fraction, isDragging, handlers } = useDragFraction({
		onCommit: (next) => onSeek(next * duration),
		disabled: !canSeek,
	});

	const progress = fraction ?? (canSeek ? Math.min(elapsed / duration, 1) : 0);

	return (
		<div
			ref={ref}
			className={styles.bar}
			data-scrubbing={isDragging}
			data-seekable={canSeek}
			role="slider"
			tabIndex={canSeek ? 0 : -1}
			aria-label={t("player.position")}
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
			<span className={styles.thumb} style={{ left: `${progress * 100}%` }} />
		</div>
	);
}
