import { useEffect } from "react";

import { useConnection } from "@/domain/player/connection";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { readTrack } from "@/shared/api/playerState";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type PlaybackBadge, setFavicon } from "./favicon";
import { useMediaSession } from "./useMediaSession";

const NAME = "Jean";

export function useDocumentIdentity() {
	const t = useTranslate();
	const connection = useConnection();
	const isDisconnected = connection !== "connected";
	const snapshot = useAudiblePlayer();

	const player = snapshot?.player;
	const track = readTrack(player);
	const hasTrack = Boolean(track);

	const badge: PlaybackBadge = isDisconnected
		? "offline"
		: player?.playbackState === "playing"
			? "playing"
			: hasTrack && player?.playbackState === "paused"
				? "paused"
				: "idle";

	const title = isDisconnected
		? `${t(connection === "playerUnresponsive" ? "player.unresponsive" : "player.disconnected")} · ${NAME}`
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
