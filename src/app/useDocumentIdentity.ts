import { useEffect } from "react";

import { useAudiblePlayer, usePlayer } from "@/domain/player/usePlayer";
import { readTrack } from "@/shared/api/beefweb";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type PlaybackBadge, setFavicon } from "./favicon";
import { useMediaSession } from "./useMediaSession";

const NAME = "Jean";

export function useDocumentIdentity() {
	const t = useTranslate();
	const { isError } = usePlayer();
	const snapshot = useAudiblePlayer();

	const player = snapshot?.player;
	const track = readTrack(player);
	const hasTrack = Boolean(track && (player?.activeItem?.index ?? -1) >= 0);

	const badge: PlaybackBadge = isError
		? "offline"
		: player?.playbackState === "playing"
			? "playing"
			: hasTrack && player?.playbackState === "paused"
				? "paused"
				: "idle";

	const title = isError
		? `${t("player.disconnected")} · ${NAME}`
		: hasTrack
			? `${track?.title} — ${track?.artist} · ${NAME}`
			: NAME;

	useEffect(() => {
		document.title = title;
	}, [title]);

	useEffect(() => {
		setFavicon(badge);
	}, [badge]);

	useMediaSession(snapshot, track, hasTrack);
}
