import { useMemo } from "react";

import { tokenize } from "@/shared/lib/text";
import type { TrackRows } from "./project";
import { rowMatches, type SearchIndex, searchIndex } from "./searchText";

const MAX_RESULTS = 60;

export function useSearchIndex(
	rows: TrackRows,
	enabled: boolean,
): SearchIndex | null {
	return useMemo(
		() => (enabled ? searchIndex(rows.columns) : null),
		[rows.columns, enabled],
	);
}

export function search(
	index: SearchIndex | null,
	rows: TrackRows,
	query: string,
): { matches: Set<number> | null; results: number[] } {
	const tokens = tokenize(query);
	if (!index || tokens.length === 0) return { matches: null, results: [] };

	const matches = new Set<number>();
	for (let position = 0; position < rows.length; position += 1)
		if (rowMatches(index, rows.ref(position), tokens)) matches.add(position);

	return { matches, results: [...matches].slice(0, MAX_RESULTS) };
}
