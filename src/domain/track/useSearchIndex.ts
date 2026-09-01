import { useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { matchesTokens, tokenize } from "@/shared/lib/text";
import { rowHaystack } from "./searchText";

const MAX_RESULTS = 60;

// Built lazily -- only once somebody opens a finder -- and dropped with the
// playlist it was built for.
export function useSearchIndex(
	rows: TrackColumns[],
	enabled: boolean,
): string[] | null {
	return useMemo(
		() => (enabled ? rows.map(rowHaystack) : null),
		[rows, enabled],
	);
}

// Every match, for highlighting in place, plus a capped list to render in the
// dropdown. The list is never filtered down: finding a track must not change
// what the playlist is.
export function search(
	haystacks: string[] | null,
	query: string,
): { matches: Set<number> | null; results: number[] } {
	const tokens = tokenize(query);
	if (!haystacks || tokens.length === 0) return { matches: null, results: [] };

	const matches = new Set(
		haystacks.flatMap((haystack, index) =>
			matchesTokens(haystack, tokens) ? index : [],
		),
	);

	return { matches, results: [...matches].slice(0, MAX_RESULTS) };
}
