import type { PlayerSnapshot } from "@/shared/api/types";
import { formatTime } from "@/shared/i18n/format";
import styles from "./NowPlaying.module.css";
import { useElapsedSeconds } from "./SeekBar";

export function Times({
	snapshot,
}: {
	snapshot: PlayerSnapshot | null | undefined;
}) {
	const elapsed = useElapsedSeconds(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	return (
		<div className={styles.times}>
			<span className="tabular">{formatTime(elapsed)}</span>
			<span className="tabular">
				{duration > 0 ? `−${formatTime(Math.max(0, duration - elapsed))}` : "—"}
			</span>
		</div>
	);
}
