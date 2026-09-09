import { X } from "lucide-react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Lyrics } from "./Lyrics";
import styles from "./LyricsScreen.module.css";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";

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
	const t = useTranslate();
	useEscapeCapture(onClose);

	const swipe = useSwipe({ onDown: onClose });

	return (
		<section
			className={styles.screen}
			data-now-playing=""
			aria-label={t("panel.lyrics")}
			{...swipe}
		>
			<div className={styles.bar}>
				<button
					type="button"
					className={styles.close}
					aria-label={t("lyrics.closeFullScreen")}
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
