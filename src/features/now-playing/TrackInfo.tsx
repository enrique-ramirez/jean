import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useSwipe } from "@/shared/hooks/useSwipe";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import styles from "./TrackInfo.module.css";
import { TrackPanels } from "./TrackPanels";

/** Must match the exit animation in TrackInfo.module.css. */
export const INFO_EXIT_MS = 220;

// What is written about the track, on a phone: the layer the Lyrics button opens over the player.
export function TrackInfo({
	isOpen,
	title,
	artist,
	lyrics,
	snapshot,
	onSeek,
	trackKey,
	onClose,
}: {
	/** False while it plays its exit; the caller keeps it mounted for that long. */
	isOpen: boolean;
	title: string;
	artist: string;
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	trackKey: string;
	onClose: () => void;
}) {
	// Default "down": a chevron press names no direction, so it gets the way the layer came in.
	const [exit, setExit] = useState<"up" | "down">("down");

	const close = (towards: "up" | "down") => {
		setExit(towards);
		onClose();
	};

	useEscapeCapture(() => close("down"));

	// On a panel with nothing to scroll — most tracks, most tabs — both directions close it.
	const swipe = useSwipe({
		onDown: () => close("down"),
		onUp: () => close("up"),
	});

	return (
		// The boundary every scroller lookup inside this layer resolves against.
		<section
			className={styles.screen}
			data-now-playing=""
			data-leaving={isOpen ? undefined : exit}
			aria-label="Track information"
			{...swipe}
		>
			<header className={styles.head}>
				<button
					type="button"
					className={styles.dismiss}
					aria-label="Close track information"
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
			/>
		</section>
	);
}
