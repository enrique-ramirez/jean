import { translate } from "@/shared/i18n/locale";
import type { NowPlayingTrack, PlayerState } from "./types";

export function readTrack(
	player: PlayerState | null | undefined,
): NowPlayingTrack | null {
	const path = player?.activeItem?.path;
	if (!path) return null;
	const [artist, title] = player?.activeItem?.columns ?? [];
	return {
		artist: artist || translate("track.unknownArtist"),
		title: title || translate("track.unknownTitle"),
		path,
		subsong: player?.activeItem?.subsong ?? 0,
	};
}

export function libraryPathMatcher(absolute: string | null | undefined) {
	if (!absolute) return () => false;
	const flat = absolute.replaceAll("\\", "/");
	return (relative: string | null | undefined) =>
		Boolean(relative) && (flat === relative || flat.endsWith(`/${relative}`));
}
