import type { TrackColumns } from "@/shared/api/types";
import { tokenize } from "@/shared/lib/text";
import type { Refs } from "./project";
import { type RowText, rowMatches, rowText } from "./searchText";

let held: { key: string; text: RowText[] } | null = null;

// Rows only ever grow, a chunk at a time, so the index extends in place. The key carries the item
// count, so an edited library indexes afresh rather than inheriting rows that have moved.
export function libraryIndex(key: string, rows: TrackColumns[]): RowText[] {
	if (held?.key === key) {
		for (const row of rows.slice(held.text.length))
			held.text.push(rowText(row));
		return held.text;
	}

	held = { key, text: rows.map(rowText) };
	return held.text;
}

export function searchLibrary(
	index: RowText[],
	query: string,
): Int32Array | null {
	const tokens = tokenize(query);
	if (tokens.length === 0) return null;

	const matched = index.reduce<number[]>((found, text, index) => {
		if (rowMatches(text, tokens)) found.push(index);
		return found;
	}, []);

	return Int32Array.from(matched);
}

// Bisects, so the indices have to be ascending.
export function positionOf(
	indices: Refs,
	index: number | null | undefined,
): number {
	if (index == null || index < 0) return -1;

	const bisect = (low: number, high: number): number => {
		if (low > high) return -1;
		const middle = (low + high) >> 1;
		if (indices[middle] === index) return middle;
		return indices[middle] < index
			? bisect(middle + 1, high)
			: bisect(low, middle - 1);
	};

	return bisect(0, indices.length - 1);
}
