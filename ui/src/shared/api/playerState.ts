import type { PlayerState, PlayingTrack } from "./types";

export function playingTrack(
	player: PlayerState | null | undefined,
): PlayingTrack | null {
	const path = player?.activeItem?.path;
	if (!path) return null;
	const [artist, title] = player?.activeItem?.columns ?? [];
	return {
		artist: artist || null,
		title: title || null,
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
