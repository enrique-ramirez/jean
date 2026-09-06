import { useEffect, useState } from "react";
import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDragFraction } from "@/shared/hooks/useDragFraction";
import styles from "./SeekBar.module.css";

// Sampled every animation frame; `resolution` is what React compares to decide whether to re-render.
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

/** The interpolated position, ticking. Never lift this into a shared store: it re-renders every animation frame. */
export const useElapsed = (snapshot: PlayerSnapshot | null | undefined) =>
	useTickingPosition(snapshot, exactly);

/** The same, in whole seconds, for a readout that changes once a second: React bails out on every frame landing inside the second it already drew. A caller drawing a position -- a fill, a thumb, a scrubber -- needs `useElapsed`, or the movement steps. */
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
	const elapsed = useElapsed(snapshot);

	const duration = snapshot?.player?.activeItem?.duration ?? 0;
	const canSeek = duration > 0;

	// Seeking commits on release rather than on drag, or scrubbing fires a request per pointer move and the player stutters chasing them.
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
			aria-label="Playback position"
			aria-valuemin={0}
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(progress * duration)}
			{...handlers}
		>
			<span className={styles.rail} />
			{/* scaleX rather than width: transforms skip layout entirely. */}
			<span
				className={styles.fill}
				style={{ transform: `scaleX(${progress})` }}
			/>
			<span className={styles.thumb} style={{ left: `${progress * 100}%` }} />
		</div>
	);
}
