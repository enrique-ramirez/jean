import { useEffect } from "react";

import {
	type ConnectionState,
	useConnection,
} from "@/domain/player/connection";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import { namedTrack } from "@/domain/track/fields";
import { playingTrack } from "@/shared/api/playerState";
import type { NowPlayingTrack, PlaybackState } from "@/shared/api/types";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { type PlaybackBadge, setFavicon } from "./favicon";
import { useMediaSession } from "./useMediaSession";

const NAME = "Jean";

function badgeOf(
	isDisconnected: boolean,
	playbackState: PlaybackState | undefined,
	hasTrack: boolean,
): PlaybackBadge {
	if (isDisconnected) return "offline";
	if (playbackState === "playing") return "playing";
	return hasTrack && playbackState === "paused" ? "paused" : "idle";
}

function titleOf(
	connection: ConnectionState,
	track: NowPlayingTrack | null,
	t: Translate,
): string {
	if (connection === "playerUnresponsive")
		return `${t("player.unresponsive")} · ${NAME}`;
	if (connection !== "connected")
		return `${t("player.disconnected")} · ${NAME}`;
	return track ? `${track.title} — ${track.artist} · ${NAME}` : NAME;
}

export function useDocumentIdentity() {
	const t = useTranslate();
	const connection = useConnection();
	const isDisconnected = connection !== "connected";
	const snapshot = useAudiblePlayer();

	const player = snapshot?.player;
	const track = namedTrack(playingTrack(player), t);
	const hasTrack = Boolean(track);

	const badge = badgeOf(isDisconnected, player?.playbackState, hasTrack);
	const title = titleOf(connection, track, t);

	useEffect(() => {
		document.title = title;
	}, [title]);

	useEffect(() => {
		setFavicon(badge);
	}, [badge]);

	useMediaSession(snapshot, track, hasTrack);
}
