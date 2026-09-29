import { ArrowDown, ArrowUp } from "lucide-react";
import { useRef } from "react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import type { ActiveDirection } from "./listTypes";
import styles from "./TrackBrowser.module.css";

export function NowPlayingPill({
	direction,
	onClick,
}: {
	direction: ActiveDirection;
	onClick: () => void;
}) {
	const t = useTranslate();
	const lastDirection = useRef<"up" | "down">("down");
	if (direction) lastDirection.current = direction;
	const shown = direction ?? lastDirection.current;

	return (
		<div className={styles.pillSlot} aria-hidden={!direction}>
			<button
				type="button"
				className={styles.pill}
				data-visible={Boolean(direction)}
				data-direction={shown}
				tabIndex={direction ? 0 : -1}
				onClick={onClick}
			>
				{shown === "up" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
				{t("player.nowPlaying")}
			</button>
		</div>
	);
}
