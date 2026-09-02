import { X } from "lucide-react";
import { useEffect } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Lyrics } from "./Lyrics";
import styles from "./LyricsScreen.module.css";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";

// The lyric with everything else taken away. It reuses `Lyrics` rather than
// drawing its own, so the follow, the resume pill, the seek-on-click and the
// synced/plain/empty states cannot come to mean two different things -- the
// only difference between the two views is `--lyric-size` and the amount of
// space around it.
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
	// Capture, and stopped: the playlist scope binds Escape to clearing a
	// selection, and the list is still mounted behind two layers. Closing the
	// top-most thing on screen is the only thing that key can sensibly mean here.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKey, { capture: true });
	}, [onClose]);

	// The whole of "swipe it away without sacrificing scroll" -- and it is
	// already solved. `useSwipe` reads *touch* events rather than pointer ones,
	// so it still sees a flick that the browser has claimed for scrolling, and
	// it only calls `onDown` when the thing under the finger had nowhere further
	// up to go. Halfway down a lyric a downward flick scrolls; at the top it
	// closes. No handler here has to know which.
	const swipe = useSwipe({ onDown: onClose });

	return (
		// The boundary for `scrollParentOf`, exactly as the now-playing screen is.
		// Without it the lyric follow walks past this layer, finds the track list
		// scrolling behind two screens, and drives that instead.
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
