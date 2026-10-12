import { type RefObject, useEffect, useMemo, useState } from "react";
import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDragFraction } from "@/shared/hooks/useDragFraction";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { formatTime } from "@/shared/lib/time";
import styles from "./SeekBar.module.css";
import { seekGrid } from "./seekGrid";

const useTickingPosition = (
	snapshot: PlayerSnapshot | null | undefined,
	resolution: (at: number) => number,
) => {
	const [held, setHeld] = useState(() => ({
		snapshot,
		resolution,
		value: resolution(audibleAt(snapshot)),
	}));

	let { value } = held;
	if (held.snapshot !== snapshot || held.resolution !== resolution) {
		value = resolution(audibleAt(snapshot));
		setHeld({ snapshot, resolution, value });
	}

	const isPlaying = snapshot?.player?.playbackState === "playing";

	useEffect(() => {
		if (!isPlaying) return undefined;
		let frame = requestAnimationFrame(function tick() {
			const next = resolution(audibleAt(snapshot));
			setHeld((current) =>
				current.value === next
					? current
					: { snapshot, resolution, value: next },
			);
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [snapshot, resolution, isPlaying]);

	return value;
};

const useDevicePixelWidth = (ref: RefObject<HTMLElement | null>) => {
	const [devicePixels, setDevicePixels] = useState(0);

	useEffect(() => {
		const element = ref.current;
		if (!element) return undefined;

		const observer = new ResizeObserver(([entry]) =>
			setDevicePixels(
				Math.round(entry.contentRect.width * window.devicePixelRatio),
			),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);

	return devicePixels;
};

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

	const duration = snapshot?.player?.activeItem?.duration ?? 0;
	const canSeek = duration > 0;

	const { ref, fraction, isDragging, handlers } = useDragFraction({
		onCommit: (next) => onSeek(next * duration),
		disabled: disabled || !canSeek,
	});

	const devicePixels = useDevicePixelWidth(ref);
	const toTheDevicePixel = useMemo(
		() => seekGrid(duration, devicePixels),
		[duration, devicePixels],
	);
	const elapsed = useTickingPosition(snapshot, toTheDevicePixel);

	const position =
		fraction === null ? Math.min(elapsed, duration) : fraction * duration;
	const progress = fraction ?? (canSeek ? position / duration : 0);
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
			aria-valuenow={Math.round(position)}
			aria-valuetext={t("player.positionOf", {
				elapsed: formatTime(position),
				total: formatTime(duration),
			})}
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
