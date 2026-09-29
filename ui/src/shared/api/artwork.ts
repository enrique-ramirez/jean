import { playlistPath } from "./playlists";

export const libraryArtworkUrl = (origin: string | null, path: string) =>
	origin && `${origin}/api/artwork?track=${encodeURIComponent(path)}`;

export const playingArtworkUrl = (origin: string | null) =>
	origin && `${origin}/api/artwork/playing`;

export const playlistRowArtworkUrl = (
	origin: string | null,
	playlistId: string,
	index: number,
) => origin && `${origin}/api/artwork/${playlistPath(playlistId)}/${index}`;
