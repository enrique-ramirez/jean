import type { TrackColumns } from "@/shared/api/types";
import { FIELD, tagKey, value } from "./fields";
import type { PlaylistSnapshot } from "./playlistStore";

// A ref is an integer: a playlist index on one source, a position in the paths array on the other. The search index produces an Int32Array and a shelf an ordinary array, and nothing downstream cares which.
export type Refs = Int32Array | number[];

// A view's rows and its source's refs are the same list only when nothing filtered them, which is what a null `indices` says. Stated once, because every list component and every action has to translate.
export const refAt = (indices: Refs | null | undefined, position: number) =>
	indices ? indices[position] : position;

export interface TrackView {
	rows: TrackColumns[];
	indices: Refs;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

// Heat and patina come across from the library-wide pass rather than being recomputed over the subset, so a track's warmth means the same thing in a shelf as in the whole library.
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

// Deliberately not projected: the arrays are already right, and copying the library to produce a copy of itself is the one filter that can do nothing.
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

export const EMPTY_VIEW: TrackView = Object.freeze({
	rows: [],
	indices: new Int32Array(0),
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

// Every track carrying one genre tag, in library order.
// Matched through `tagKey` and matched whole, since foobar joins multiple values with '; ' -- the same rule `summarise` counts genres by, and the two must agree or the count beside the name is a lie.
export function refsOfGenre(rows: TrackColumns[], genre: string): Int32Array {
	const wanted = tagKey(genre);
	// An empty key matches every untagged row, which is the whole library on an install with no genre tags rather than the nothing it should be.
	if (!wanted) return new Int32Array(0);

	return Int32Array.from(
		rows.reduce<number[]>((into, row, ref) => {
			if (tagKey(value(row, FIELD.genre)) === wanted) into.push(ref);
			return into;
		}, []),
	);
}
