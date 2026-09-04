import { X } from "lucide-react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Lyrics } from "./Lyrics";
import styles from "./LyricsScreen.module.css";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import { useEscapeCapture } from "./useEscapeCapture";

// The lyric with everything else taken away. Reuses `Lyrics` so the follow, the pill and the empty states cannot come to mean two different things.
export function LyricsScreen({
	lyrics,
	snapshot,
	onSeek,
	onClose,
}: {
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	onClose: () => void;
}) {
	useEscapeCapture(onClose);

	// `useSwipe` reads touch events rather than pointer ones, so it still sees a flick the browser claimed for scrolling, and only fires `onDown` at the top of the scroll.
	const swipe = useSwipe({ onDown: onClose });

	return (
		// `data-now-playing` is the boundary for `scrollParentOf`: without it the lyric follow walks past this layer and drives the track list behind it.
		<section
			className={styles.screen}
			data-now-playing=""
			aria-label="Lyrics"
			{...swipe}
		>
			<div className={styles.bar}>
				<button
					type="button"
					className={styles.close}
					aria-label="Close full-screen lyrics"
					onClick={onClose}
				>
					<X size={26} strokeWidth={2.5} />
				</button>
			</div>

			<div className={styles.body}>
				<div className={styles.measure}>
					<Lyrics lyrics={lyrics} snapshot={snapshot} onSeek={onSeek} />
				</div>
			</div>
		</section>
	);
}
