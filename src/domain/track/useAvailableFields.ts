import { useCallback, useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { FIELD, fieldIsAvailable } from "./fields";
import { hasAnyRating } from "./rating";

// The capability probe: a field the player cannot resolve returns '?' on every
// row, so what a given install supports is read off the rows themselves rather
// than from a component list we would have to maintain.
export function useAvailableFields(rows: TrackColumns[]) {
	const available = useMemo(() => {
		const fields = Object.values(FIELD).filter((field) =>
			fieldIsAvailable(rows, field),
		);

		// Rating asks a different question, because the column draws an answer
		// either way. Every other column renders '--' when a track has no value,
		// which is quiet; five empty stars on thirty thousand rows is not, and on a
		// library nobody has rated it states "unrated" thirty thousand times about
		// something the player was never asked. A resolvable field is not enough --
		// there has to be a rating in the library somewhere.
		return new Set(
			fields.filter((field) => field !== FIELD.rating || hasAnyRating(rows)),
		);
	}, [rows]);

	const isAvailable = useCallback(
		(field: number) => available.has(field),
		[available],
	);

	return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) };
}
