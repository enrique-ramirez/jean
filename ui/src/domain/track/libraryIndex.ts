import { workWhenIdle } from "@/shared/lib/idle";
import { tokenize } from "@/shared/lib/text";
import type { LibraryColumns } from "./libraryColumns";
import type { Refs } from "./project";
import {
	type FoldCache,
	foldCache,
	rowMatches,
	type SearchIndex,
} from "./searchText";

let held: { key: string; cache: FoldCache } | null = null;

export function libraryIndex(
	key: string,
	columns: LibraryColumns,
): SearchIndex {
	if (held?.key !== key) held = { key, cache: foldCache() };
	return held.cache.over(columns);
}

export function warmLibraryIndex(
	key: string,
	columns: LibraryColumns,
): () => void {
	if (held?.key !== key) held = { key, cache: foldCache() };
	const { cache } = held;
	return workWhenIdle((hasTime) => cache.warm(columns, hasTime));
}

export function searchLibrary(
	index: SearchIndex,
	trackCount: number,
	query: string,
): Int32Array | null {
	const tokens = tokenize(query);
	if (tokens.length === 0) return null;

	const matched: number[] = [];
	for (let ref = 0; ref < trackCount; ref += 1)
		if (rowMatches(index, ref, tokens)) matched.push(ref);

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
