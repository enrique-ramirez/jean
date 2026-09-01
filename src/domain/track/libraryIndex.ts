import type { TrackColumns } from "@/shared/api/types";
import { matchesTokens, tokenize } from "@/shared/lib/text";
import type { Refs } from "./project";
import { rowHaystack } from "./searchText";

const indexes = new Map<string, string[]>();

// Rows only ever grow -- appended a chunk at a time -- so the index extends in
// place instead of being rebuilt for every chunk that lands. The key carries
// the item count, so an edited library indexes afresh rather than inheriting
// rows that have moved; only one is ever held, since a superseded key is a
// stale copy of the largest thing in memory.
export function libraryIndex(key: string, rows: TrackColumns[]): string[] {
	const held = indexes.get(key);
	if (held) {
		for (const row of rows.slice(held.length)) held.push(rowHaystack(row));
		return held;
	}

	const haystacks = rows.map(rowHaystack);
	indexes.clear();
	indexes.set(key, haystacks);
	return haystacks;
}

// Refs, ascending, in library order rather than ranked: order is what makes
// album grouping mean anything, and a library is usually sorted the way its
// owner reads it.
export function searchLibrary(
	haystacks: string[],
	query: string,
): Int32Array | null {
	const tokens = tokenize(query);
	if (tokens.length === 0) return null;

	const matched = haystacks.reduce<number[]>((found, haystack, index) => {
		if (matchesTokens(haystack, tokens)) found.push(index);
		return found;
	}, []);

	return Int32Array.from(matched);
}

// Results are ascending, so finding the row the player is on is a bisection
// rather than a scan -- this runs on every position update.
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
