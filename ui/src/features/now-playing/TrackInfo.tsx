import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { PanelTab } from "@/domain/track/routes";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import styles from "./TrackInfo.module.css";
import { TrackPanels } from "./TrackPanels";

/** Must match the exit animation in TrackInfo.module.css. */
export const INFO_EXIT_MS = 220;

export function TrackInfo({
	isOpen,
	title,
	artist,
	lyrics,
	snapshot,
	onSeek,
	trackKey,
	onClose,
	tab,
	onSelectTab,
}: {
	isOpen: boolean;
	title: string;
	artist: string;
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	trackKey: string;
	onClose: () => void;
	tab: PanelTab | null;
	onSelectTab: (tab: PanelTab) => void;
}) {
	const t = useTranslate();
	const [exit, setExit] = useState<"up" | "down">("down");

	const close = (towards: "up" | "down") => {
		setExit(towards);
		onClose();
	};

	useEscapeCapture(() => close("down"));

	const swipe = useSwipe({
		onDown: () => close("down"),
		onUp: () => close("up"),
	});

	return (
		<section
			className={styles.screen}
			data-now-playing=""
			data-leaving={isOpen ? undefined : exit}
			aria-label={t("panel.trackInfo")}
			{...swipe}
		>
			<header className={styles.head}>
				<button
					type="button"
					className={styles.dismiss}
					aria-label={t("panel.closeTrackInfo")}
					onClick={() => close("down")}
				>
					<ChevronDown size={20} strokeWidth={2} />
				</button>

				<div className={styles.identity}>
					<p className={styles.title}>{title}</p>
					<p className={styles.artist}>{artist}</p>
				</div>
			</header>

			<TrackPanels
				variant="screen"
				lyrics={lyrics}
				snapshot={snapshot}
				onSeek={onSeek}
				trackKey={trackKey}
				tab={tab}
				onSelectTab={onSelectTab}
			/>
		</section>
	);
}
