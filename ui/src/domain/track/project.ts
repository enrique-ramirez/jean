import type { TrackColumns } from "@/shared/api/types";
import { FIELD, tagKey, value } from "./fields";
import type { PlaylistSnapshot } from "./playlistStore";

// A ref is an integer: a playlist index on one source, a position in the paths array on the other.
export type Refs = Int32Array | number[];

export const refAt = (indices: Refs | null | undefined, position: number) =>
	indices ? indices[position] : position;

export interface TrackView {
	rows: TrackColumns[];
	indices: Refs;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

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

// Matched whole, since foobar joins multiple values with '; '. `summarise` counts genres by the same
// rule and the two have to stay in step, or the count beside a name disagrees with the tracks behind it.
export function refsOfGenre(rows: TrackColumns[], genre: string): Int32Array {
	const wanted = tagKey(genre);
	if (!wanted) return new Int32Array(0);

	return Int32Array.from(
		rows.reduce<number[]>((into, row, ref) => {
			if (tagKey(value(row, FIELD.genre)) === wanted) into.push(ref);
			return into;
		}, []),
	);
}
