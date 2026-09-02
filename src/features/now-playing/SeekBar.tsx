import { useEffect, useState } from "react";
import { listeningPosition } from "@/domain/player/listenerStore";
import { positionAt } from "@/domain/player/position";
import { readTrack } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDragFraction } from "@/shared/hooks/useDragFraction";
import styles from "./SeekBar.module.css";

// **What is audible here, which is not what the player is doing.** A device
// listening to the stream is a second or two behind the player, so a bar driven
// from beefweb alone runs ahead of the sound coming out of it.
//
// One branch, in one place. `listeningPosition` answers null whenever it cannot
// be sure -- not listening, no anchor yet, or a mark naming a track beefweb has
// already moved on from -- and null means drive it from beefweb exactly as
// before. Read per frame rather than pushed, because `currentTime` advances
// continuously and a store notifying on it would repaint the app sixty times a
// second.
const elapsedAt = (snapshot: PlayerSnapshot | null | undefined) => {
	const item = snapshot?.player?.activeItem;
	const audible = listeningPosition(
		readTrack(snapshot?.player)?.path,
		item?.duration ?? 0,
	);
	return audible ?? positionAt(snapshot, performance.now());
};

// The interpolated position, ticking. Deliberately a leaf's own state, never
// lifted: this re-renders every animation frame, and a shared store would
// repaint the virtualised track list sixty times a second.
export function useElapsed(snapshot: PlayerSnapshot | null | undefined) {
	const [elapsed, setElapsed] = useState(() => elapsedAt(snapshot));

	useEffect(() => {
		let frame = requestAnimationFrame(function tick() {
			setElapsed(elapsedAt(snapshot));
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
