import { useEffect, useState } from "react";

import type { PlayerSnapshot } from "../api/types";
import { useDragFraction } from "../ui/useDragFraction";
import { positionAt } from "./position";
import styles from "./SeekBar.module.css";

// The interpolated position, ticking. Deliberately a leaf's own state, never
// lifted: this re-renders every animation frame, and a shared store would
// repaint the virtualised track list sixty times a second.
export function useElapsed(snapshot: PlayerSnapshot | null | undefined) {
	const [elapsed, setElapsed] = useState(() =>
		positionAt(snapshot, performance.now()),
	);

	useEffect(() => {
		let frame = requestAnimationFrame(function tick() {
			setElapsed(positionAt(snapshot, performance.now()));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [snapshot]);

	return elapsed;
}

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

	// Seeking commits on release rather than on drag: scrubbing would otherwise
	// fire a request per pointer move and the player would stutter chasing them.
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
