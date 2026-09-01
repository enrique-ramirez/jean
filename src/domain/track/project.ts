import type { TrackColumns } from "@/shared/api/types";
import type { PlaylistSnapshot } from "./playlistStore";

// A ref is an integer -- a playlist index on one source, a position in the
// library's own paths array on the other -- and that is what keeps the source
// seam from leaking. The search index produces an Int32Array; a shelf produces
// an ordinary array. Nothing downstream cares which, so both are a Refs.
export type Refs = Int32Array | number[];

// The shape every list in the app renders: rows to draw, the refs they came
// from, and the two intensity ramps carried across from the library-wide pass.
export interface TrackView {
	rows: TrackColumns[];
	indices: Refs;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

// A view of the library is a list of refs into it, projected onto the arrays
// the track list already speaks. Every view goes through here -- search, all
// music, a shelf -- so they cannot drift into different shapes.
//
// Heat and patina come across from the library-wide pass rather than being
// recomputed over the subset, so a track's warmth means the same thing in a
// shelf as it does in the whole library.
export function project(
	library: PlaylistSnapshot,
	refs: Refs | null | undefined,
): TrackView | null {
	if (!refs) return null;

	const heat = Float32Array.from(refs, (ref) => library.heat[ref]);

	return {
		rows: Array.from(refs, (ref) => library.rows[ref]),
		indices: refs,
		heat,
		patina: Float32Array.from(refs, (ref) => library.patina[ref]),
		playedCount: heat.reduce(
			(played, warmth) => played + (warmth > 0 ? 1 : 0),
			0,
		),
	};
}

// The unfiltered view, which is every row in order. Deliberately not projected:
// the arrays are already exactly right, and copying the library to produce a
// copy of itself is the one filter that can afford to do nothing.
export const wholeLibrary = (library: PlaylistSnapshot): TrackView => ({
	rows: library.rows,
	indices: Int32Array.from(
		{ length: library.rows.length },
		(_, index) => index,
	),
	heat: library.heat,
	patina: library.patina,
	playedCount: library.playedCount ?? 0,
});

// Nothing at all, in the shape every view has. Shared so the empty state and a
// real one cannot disagree about what a view is.
export const EMPTY_VIEW: TrackView = Object.freeze({
	rows: [],
	indices: new Int32Array(0),
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});
