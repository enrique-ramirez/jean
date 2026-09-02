import { summarise } from "@/domain/track/stats";
import type { TrackColumns } from "@/shared/api/types";
import type { CoveredAlbum } from "./albums";
import { type Artist, artistsOf, mostPlayed } from "./artists";

// How many bars the genre block draws, and the number is set against the ranked
// track list it sits beside rather than against the data: the two are one band,
// and a column ending halfway up its neighbour reads as a section that failed to
// fill rather than as one that ended. A bar's pitch is ~28px against ~43px for a
// track row, so ten rows is about fourteen bars. Change `TOP_TRACKS` in
// `HomeView.tsx` and this wants changing with it.
//
// It is a cap, not a promise: a library with four genres draws four.
const GENRE_BARS = 14;

// The front door's own figures: what `summarise` says about every set of
// tracks, plus the three things only a whole library has. The albums come from
// the pass the shelves already made rather than a second one of our own.
//
// **Each figure that can name something does.** A count on its own is a readout;
// a count that ends in a record you can press is a door. That is the difference
// between this and the rail of five numbers it replaced, and it is why the
// artists are aggregated here rather than counted with a `Set`.
// Takes *covered* albums rather than bare ones, because two of the three cards
// end in a record and a record on this screen is drawn with its sleeve.
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
		// Null on a library the player keeps no play counts for, which is the same
		// absence the shelves already drop rather than dress as a fact.
		topAlbum: mostPlayed(albums),
		topArtist: mostPlayed(artists),
	};
}

// The front door's figures, inferred from the function that computes them.
export type LibraryStats = ReturnType<typeof libraryStats>;
