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
		libraryOrdinal: player?.activeItem?.libraryOrdinal ?? null,
	};
}

export function libraryPathTails(absolute: string): string[] {
	const flat = absolute.replaceAll("\\", "/");
	const tails = [flat];
	for (let at = flat.indexOf("/"); at >= 0; at = flat.indexOf("/", at + 1))
		tails.push(flat.slice(at + 1));
	return tails;
}

export function libraryPathMatcher(absolute: string | null | undefined) {
	if (!absolute) return () => false;
	const tails = new Set(libraryPathTails(absolute));
	return (relative: string | null | undefined) =>
		Boolean(relative) && tails.has(relative as string);
}
