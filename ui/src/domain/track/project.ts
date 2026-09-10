import type { TrackColumns } from "@/shared/api/types";
import { EMPTY_COLUMNS, FIELD, tagGroups, tagKey } from "./fields";
import { type LibraryColumns, rowAt } from "./libraryColumns";
import type { PlaylistSnapshot } from "./playlistStore";

// A ref is an integer: a playlist index on one source, a position in the paths array on the other.
export type Refs = Int32Array | number[];

export const refAt = (indices: Refs | null | undefined, position: number) =>
	indices ? indices[position] : position;

export interface TrackRows {
	readonly length: number;
	readonly columns: LibraryColumns;
	readonly indices: Refs | null;
	readonly at: (position: number) => TrackColumns;
	readonly ref: (position: number) => number;
}

export interface TrackView extends TrackRows {
	indices: Refs;
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

export const trackRows = (
	columns: LibraryColumns,
	indices: Refs | null = null,
): TrackRows => ({
	length: indices ? indices.length : columns.trackCount,
	columns,
	indices,
	at: (position) => rowAt(columns, refAt(indices, position)),
	ref: (position) => refAt(indices, position),
});

export function project(
	library: PlaylistSnapshot,
	refs: Refs | null | undefined,
): TrackView | null {
	if (!refs) return null;

	const heat = Float32Array.from(refs, (ref) => library.heat[ref]);

	return {
		...trackRows(library.columns, refs),
		indices: refs,
		heat,
		patina: Float32Array.from(refs, (ref) => library.patina[ref]),
		playedCount: heat.reduce(
			(played, warmth) => played + (warmth > 0 ? 1 : 0),
			0,
		),
	};
}

export const wholeLibrary = (library: PlaylistSnapshot): TrackView => {
	const indices = Int32Array.from(
		{ length: library.columns.trackCount },
		(_, index) => index,
	);

	return {
		...trackRows(library.columns, indices),
		indices,
		heat: library.heat,
		patina: library.patina,
		playedCount: library.playedCount ?? 0,
	};
};

export const EMPTY_VIEW: TrackView = Object.freeze({
	...trackRows(EMPTY_COLUMNS, new Int32Array(0)),
	indices: new Int32Array(0),
	heat: new Float32Array(0),
	patina: new Float32Array(0),
	playedCount: 0,
});

// Matched whole, since foobar joins multiple values with '; '. `summarise` counts genres by the same
// rule and the two have to stay in step, or the count beside a name disagrees with the tracks behind it.
export function refsOfGenre(
	columns: LibraryColumns,
	genre: string,
): Int32Array {
	const wanted = tagKey(genre);
	if (!wanted) return new Int32Array(0);

	const column = columns.fields[FIELD.genre];
	const groups = tagGroups(column);
	const group = groups.group(wanted);
	if (group < 0) return new Int32Array(0);

	const refs: number[] = [];
	for (let ref = 0; ref < columns.trackCount; ref += 1)
		if (groups.of[column.ids[ref]] === group) refs.push(ref);

	return Int32Array.from(refs);
}
