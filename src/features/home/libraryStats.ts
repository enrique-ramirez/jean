import { summarise } from "@/domain/track/stats";
import type { TrackColumns } from "@/shared/api/types";
import type { CoveredAlbum } from "./albums";
import { type Artist, artistsOf, mostPlayed } from "./artists";

// A cap rather than a promise, set so the bars end level with the ranked track list beside them: a bar's pitch is ~28px against ~43px for a track row. Change `TOP_TRACKS` in `HomeView.tsx` and this wants changing with it.
const GENRE_BARS = 14;

/** The front door's figures: what `summarise` says about any set of tracks, plus the three things only a whole library has. Albums come from the pass the shelves already made. */
export function libraryStats({
	rows,
	albums,
}: {
	rows: TrackColumns[];
	albums: CoveredAlbum[];
}) {
	const artists: Artist<CoveredAlbum>[] = artistsOf(albums);

	return {
		...summarise(rows, 0, { genres: GENRE_BARS }),
		albumCount: albums.length,
		artistCount: artists.length,
		// Null on a library the player keeps no play counts for.
		topAlbum: mostPlayed(albums),
		topArtist: mostPlayed(artists),
	};
}

export type LibraryStats = ReturnType<typeof libraryStats>;
