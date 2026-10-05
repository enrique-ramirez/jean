import { sessionScope } from "./client";
import { playlistPath } from "./playlists";

export const libraryArtworkUrl = (origin: string | null, path: string) =>
	origin && `${origin}/api/artwork?track=${encodeURIComponent(path)}`;

export const playingArtworkUrl = (origin: string | null) => {
	if (!origin) return origin;
	const scope = sessionScope();
	const url = `${origin}/api/artwork/playing`;
	return scope ? `${url}?${new URLSearchParams({ ...scope })}` : url;
};

export const playlistRowArtworkUrl = (
	origin: string | null,
	playlistId: string,
	index: number,
) => origin && `${origin}/api/artwork/${playlistPath(playlistId)}/${index}`;
