import { useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { tokenize } from "@/shared/lib/text";
import { type RowText, rowMatches, rowText } from "./searchText";

const MAX_RESULTS = 60;

export function useSearchIndex(
	rows: TrackColumns[],
	enabled: boolean,
): RowText[] | null {
	return useMemo(() => (enabled ? rows.map(rowText) : null), [rows, enabled]);
}

export function search(
	index: RowText[] | null,
	query: string,
): { matches: Set<number> | null; results: number[] } {
	const tokens = tokenize(query);
	if (!index || tokens.length === 0) return { matches: null, results: [] };

	const matches = new Set(
		index.flatMap((text, position) =>
			rowMatches(text, tokens) ? position : [],
		),
	);

	return { matches, results: [...matches].slice(0, MAX_RESULTS) };
}
