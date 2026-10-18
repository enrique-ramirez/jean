import type { Query } from "@/shared/lib/text";
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

let lastSearch: {
	index: SearchIndex;
	trackCount: number;
	tokens: string[];
	matched: Int32Array;
} | null = null;

const narrows = (tokens: string[], earlier: string[]) =>
	earlier.every((had) => tokens.some((token) => token.includes(had)));

export function searchLibrary(
	index: SearchIndex,
	trackCount: number,
	query: Query,
): Int32Array | null {
	const { tokens } = query;
	if (tokens.length === 0) return null;

	const candidates =
		lastSearch?.index === index &&
		lastSearch.trackCount === trackCount &&
		narrows(tokens, lastSearch.tokens)
			? lastSearch.matched
			: null;

	const matched: number[] = [];
	if (candidates) {
		for (const ref of candidates)
			if (rowMatches(index, ref, query)) matched.push(ref);
	} else {
		for (let ref = 0; ref < trackCount; ref += 1)
			if (rowMatches(index, ref, query)) matched.push(ref);
	}

	lastSearch = { index, trackCount, tokens, matched: Int32Array.from(matched) };
	return lastSearch.matched;
}

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
