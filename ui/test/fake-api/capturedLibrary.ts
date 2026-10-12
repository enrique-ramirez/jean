import capturedLibrary from "./library.json" with { type: "json" };

export type Track = Record<string, string>;

interface CapturedAlbum {
	slug: string;
	artwork?: string;
	tracks: Track[];
}

export const LIBRARY = capturedLibrary as { albums: CapturedAlbum[] };

// Copies, because a tag write or a counted play lands in the track object
// itself, and the captured fixture outlives every state one worker builds.
const copied = (tracks: Track[]) => tracks.map((track) => ({ ...track }));
export const tracksOf = (album: string) =>
	copied(LIBRARY.albums.find((entry) => entry.slug === album)?.tracks ?? []);
export const allTracks = () =>
	copied(LIBRARY.albums.flatMap((album) => album.tracks));
