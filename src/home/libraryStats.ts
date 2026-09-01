import type { PlaylistInfo, TrackColumns } from "../api/types";
import { withoutJeanPlaylists } from "../library/jeanPlaylists";
import { summarise } from "../playlist/stats";
import type { Album } from "./albums";

// Loosely, because these are counts rather than labels: `5 Seconds Of Summer`
// and `5 Seconds of Summer` are one artist. The name shown anywhere is still
// the file's own.
const loosely = (text: string) =>
	text.toLowerCase().replace(/\s+/g, " ").trim();

// The front door's own figures: what `summarise` says about every set of
// tracks, plus the three things only a whole library has. The albums come from
// the pass the shelves already made rather than a second one of our own.
export function libraryStats({
	rows,
	albums,
	playlists,
}: {
	rows: TrackColumns[];
	albums: Album[];
	playlists: PlaylistInfo[];
}) {
	return {
		...summarise(rows),
		albumCount: albums.length,
		artistCount: new Set(albums.map((album) => loosely(album.artist))).size,
		// Jean's own are plumbing, not the user's music. Counting them would make
		// this disagree with the sidebar two centimetres to its left.
		playlistCount: withoutJeanPlaylists(playlists).length,
	};
}

// The front door's figures, inferred from the function that computes them.
export type LibraryStats = ReturnType<typeof libraryStats>;
