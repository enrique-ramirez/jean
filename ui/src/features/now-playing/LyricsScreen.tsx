import { X } from "lucide-react";

import { KEY_SEEK_SECONDS, useSeekBy } from "@/domain/player/usePlayer";
import { permitsPlaybackControl } from "@/shared/api/fooJean";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Lyrics } from "./Lyrics";
import styles from "./LyricsScreen.module.css";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";

const LYRICS_KEYBOARD = "lyrics-full";

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
	useKeyboardOwnership(LYRICS_KEYBOARD);
	useEscapeCapture(onClose);

	const { discovery } = useFooJean();
	const seekBy = useSeekBy();
	useKeymap(
		SCOPE.global,
		{
			seekBack: () => seekBy.mutate(-KEY_SEEK_SECONDS),
			seekForward: () => seekBy.mutate(KEY_SEEK_SECONDS),
		},
		{ enabled: permitsPlaybackControl(discovery), owner: LYRICS_KEYBOARD },
	);
	useKeymap(
		SCOPE.nowPlaying,
		{ fullScreen: onClose },
		{ owner: LYRICS_KEYBOARD },
	);

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
